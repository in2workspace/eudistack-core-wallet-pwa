import { inject, Injectable } from '@angular/core';
import { JwtService } from './jwt.service';

export interface SdJwtParts {
  issuerJwt: string;
  disclosures: string[];
}

export interface DecodedDisclosure {
  salt: string;
  claimName: string;
  claimValue: unknown;
}

export interface ReconstructedSdJwt {
  payload: Record<string, unknown>;
  issuerJwt: string;
}

@Injectable({ providedIn: 'root' })
export class SdJwtParserService {

  private readonly jwtService = inject(JwtService);

  isSdJwt(credential: string): boolean {
    return credential.includes('~');
  }

  split(compact: string): SdJwtParts {
    const segments = compact.split('~');
    const issuerJwt = segments[0];
    const disclosures = segments.slice(1).filter(s => s.length > 0);
    return { issuerJwt, disclosures };
  }

  decodeDisclosure(encoded: string): DecodedDisclosure {
    const bytes = this.jwtService.base64UrlDecodeToBytes(encoded);
    const json = new TextDecoder().decode(bytes);
    const arr = JSON.parse(json);

    if (!Array.isArray(arr) || arr.length !== 3) {
      throw new Error(`Invalid disclosure: expected [salt, name, value], got ${json}`);
    }

    return {
      salt: arr[0],
      claimName: arr[1],
      claimValue: arr[2],
    };
  }

  reconstructClaims(compact: string): ReconstructedSdJwt {
    const { issuerJwt, disclosures } = this.split(compact);
    const payload = { ...(this.jwtService.parseJwtPayload(issuerJwt) as Record<string, unknown>) };

    for (const encoded of disclosures) {
      const { claimName, claimValue } = this.decodeDisclosure(encoded);
      payload[claimName] = claimValue;
    }

    delete payload['_sd'];
    delete payload['_sd_alg'];

    return { payload, issuerJwt };
  }
}
