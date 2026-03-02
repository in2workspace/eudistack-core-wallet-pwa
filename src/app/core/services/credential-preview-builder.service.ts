import { inject, Injectable } from '@angular/core';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CredentialPreview, Power } from '../models/credential-preview';

@Injectable({ providedIn: 'root' })
export class CredentialPreviewBuilderService {

  private readonly jwtService = inject(JwtService);

  buildPreview(credentialResponse: CredentialResponse): CredentialPreview {
    const credentialJwt = credentialResponse.credentials?.[0]?.credential;
    if (!credentialJwt) {
      return this.emptyPreview();
    }

    try {
      const payload = this.jwtService.parseJwtPayload(credentialJwt) as Record<string, any>;
      const vc = payload['vc'] ?? payload;
      return this.mapVcToPreview(vc);
    } catch {
      return this.emptyPreview();
    }
  }

  private mapVcToPreview(vc: Record<string, any>): CredentialPreview {
    const cs = vc?.['credentialSubject'];
    const mandate = cs?.['mandate'];
    const mandatee = mandate?.['mandatee'];

    const firstName = mandatee?.['firstName'] ?? '';
    const lastName = mandatee?.['lastName'] ?? '';
    const subjectName = `${firstName} ${lastName}`.trim() || '';

    const organization = String(mandate?.['mandator']?.['organization'] ?? '');

    const rawPowers: any[] = mandate?.['power'] ?? [];
    const power: Power[] = rawPowers.map((p: any) => ({
      function: p?.['function'] ?? '',
      action: Array.isArray(p?.['action']) ? p['action'] : [],
    }));

    const expirationDate = String(vc?.['validUntil'] ?? '');

    return { power, subjectName, organization, expirationDate };
  }

  private emptyPreview(): CredentialPreview {
    return { power: [], subjectName: '', organization: '', expirationDate: '' };
  }
}
