import { inject, Injectable } from '@angular/core';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { SdJwtParserService } from '../protocol/oid4vci/sd-jwt-parser.service';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CredentialPreview } from '../models/credential-preview';
import { CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';
import { CredentialDisplayService } from './credential-display.service';

/** Claims that are JWT/SD-JWT envelope metadata, not credential data. */
const SD_JWT_STANDARD_CLAIMS = new Set([
  'iss', 'iat', 'exp', 'nbf', 'sub', 'jti', 'cnf', 'vct',
  'status', 'type', '@context', 'id', 'credentialSubject',
  'issuer', 'validFrom', 'validUntil', 'issuanceDate', 'expirationDate',
  'credentialStatus', '_sd', '_sd_alg',
]);

@Injectable({ providedIn: 'root' })
export class CredentialPreviewBuilderService {

  private readonly jwtService = inject(JwtService);
  private readonly sdJwtParser = inject(SdJwtParserService);
  private readonly displayService = inject(CredentialDisplayService);

  buildPreview(
    credentialResponse: CredentialResponse,
    credentialMetadata?: CredentialMetadata,
    format?: string
  ): CredentialPreview {
    const credential = credentialResponse.credentials?.[0]?.credential;
    if (!credential) return this.emptyPreview();

    try {
      const vc = this.extractVc(credential);
      const cs = vc?.['credentialSubject'];

      return {
        displayName: credentialMetadata?.display?.[0]?.name ?? '',
        format: this.getHumanFormat(format),
        fields: credentialMetadata
          ? this.displayService.buildFieldsFromClaims(cs, credentialMetadata)
          : [],
        sections: credentialMetadata
          ? this.displayService.createSectionsFromClaims(cs, credentialMetadata)
          : [],
        expirationDate: String(vc?.['validUntil'] ?? vc?.['expirationDate'] ?? ''),
      };
    } catch {
      return this.emptyPreview();
    }
  }

  private extractVc(credential: string): Record<string, any> {
    if (this.sdJwtParser.isSdJwt(credential)) {
      const { payload } = this.sdJwtParser.reconstructClaims(credential);
      const exp = payload['exp'] as number | undefined;
      const credentialSubject = payload['credentialSubject'] ??
        Object.fromEntries(
          Object.entries(payload).filter(([k]) => !SD_JWT_STANDARD_CLAIMS.has(k))
        );
      return {
        credentialSubject,
        validUntil: exp ? new Date(exp * 1000).toISOString() : '',
      };
    }
    const payload = this.jwtService.extractJwtPayload(credential) as Record<string, any>;
    return payload['vc'] ?? payload;
  }

  private getHumanFormat(format?: string): string {
    if (!format) return '';
    switch (format) {
      case 'dc+sd-jwt': return 'SD-JWT';
      case 'jwt_vc_json': return 'JWT';
      default: return format;
    }
  }

  private emptyPreview(): CredentialPreview {
    return { displayName: '', format: '', fields: [], sections: [], expirationDate: '' };
  }
}