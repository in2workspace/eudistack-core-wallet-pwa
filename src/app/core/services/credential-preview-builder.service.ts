import { inject, Injectable } from '@angular/core';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { SdJwtParserService } from '../protocol/oid4vci/sd-jwt-parser.service';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CredentialPreview, Power, PreviewField } from '../models/credential-preview';
import { CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';

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

  buildPreview(
    credentialResponse: CredentialResponse,
    credentialMetadata?: CredentialMetadata,
    format?: string
  ): CredentialPreview {
    const credential = credentialResponse.credentials?.[0]?.credential;
    if (!credential) {
      return this.emptyPreview();
    }

    try {
      const vc = this.extractVc(credential);

      // Metadata-driven path: generic for any credential type
      if (credentialMetadata?.claims?.length) {
        return {
          displayName: credentialMetadata.display?.[0]?.name ?? '',
          format: this.getHumanFormat(format),
          fields: this.createDynamicFields(vc, credentialMetadata),
          power: [],
          subjectName: '',
          organization: '',
          expirationDate: this.extractExpiration(vc),
        };
      }

      // Legacy fallback: hardcoded mandate/mandatee structure
      return this.mapVcToPreview(vc);
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

  private extractExpiration(vc: Record<string, any>): string {
    return String(vc?.['validUntil'] ?? vc?.['expirationDate'] ?? '');
  }

  private createDynamicFields(vc: Record<string, any>, meta: CredentialMetadata): PreviewField[] {
    const cs = vc?.['credentialSubject'];
    if (!cs || !meta.claims) return [];

    const fields: PreviewField[] = [];
    for (const claim of meta.claims) {
      // Strip leading 'credentialSubject' from path — we already navigate into it
      const path = claim.path[0] === 'credentialSubject' ? claim.path.slice(1) : claim.path;

      const value = resolveByPath(cs, path);
      if (value == null || value === '') continue;

      const label = claim.display?.[0]?.name ?? path[path.length - 1];

      // All values (including arrays of objects) are rendered generically
      fields.push({ label, value: this.stringifyValue(value) });
    }
    return fields;
  }

  private getHumanFormat(format?: string): string {
    if (!format) return '';
    switch (format) {
      case 'dc+sd-jwt': return 'SD-JWT';
      case 'jwt_vc_json': return 'JWT';
      default: return format;
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

    return { displayName: '', format: '', fields: [], power, subjectName, organization, expirationDate };
  }

  private emptyPreview(): CredentialPreview {
    return { displayName: '', format: '', fields: [], power: [], subjectName: '', organization: '', expirationDate: '' };
  }

  private stringifyValue(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(v => this.stringifyValue(v)).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
}

function resolveByPath(obj: any, path: string[]): unknown {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}
