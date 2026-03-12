import { Injectable } from '@angular/core';
import { ExtendedCredentialType, VerifiableCredential } from '../../core/models/verifiable-credential';
import { DcqlCredentialQuery, DcqlQuery } from '../../core/protocol/oid4vp/authorization-request.model';

const SCOPE_TO_TYPE: Record<string, string> = {
  'learcredential.employee': 'learcredential.employee.w3c.4',
  'learcredential.machine': 'learcredential.machine.w3c.3',
};

@Injectable({
  providedIn: 'root'
})
export class CredentialCacheService {

  private credentials: VerifiableCredential[] = [];

  syncFromBackend(credentials: VerifiableCredential[]): void {
    this.credentials = [...credentials];
  }

  getAll(): VerifiableCredential[] {
    return [...this.credentials];
  }

  findCredentialsByType(type: string): VerifiableCredential[] {
    return this.credentials.filter(
      cred => cred.type?.includes(type as ExtendedCredentialType) && cred.lifeCycleStatus === 'VALID'
    );
  }

  findCredentialsByDcqlQuery(dcqlQuery: DcqlQuery): VerifiableCredential[] {
    const matchingCredentials: VerifiableCredential[] = [];

    for (const credQuery of dcqlQuery.credentials) {
      const matched = this.matchCredentialQuery(credQuery);
      matchingCredentials.push(...matched);
    }

    // Deduplicate by credential id
    const seen = new Set<string>();
    return matchingCredentials.filter(cred => {
      if (seen.has(cred.id)) return false;
      seen.add(cred.id);
      return true;
    });
  }

  findCredentialsByScope(scopes: string[]): VerifiableCredential[] {
    const types = scopes
      .map(scope => SCOPE_TO_TYPE[scope])
      .filter((type): type is string => !!type);

    if (types.length === 0) return [];

    return this.credentials.filter(
      cred => cred.lifeCycleStatus === 'VALID' &&
        cred.type?.some(t => types.includes(t))
    );
  }

  extractSignedJwt(credential: VerifiableCredential): string | undefined {
    return credential.credentialEncoded;
  }

  private matchCredentialQuery(credQuery: DcqlCredentialQuery): VerifiableCredential[] {
    return this.credentials.filter(cred => {
      if (cred.lifeCycleStatus !== 'VALID') return false;

      // Match by format-specific metadata
      if (credQuery.format === 'jwt_vc_json') {
        return this.matchJwtVcJson(cred, credQuery);
      }

      if (credQuery.format === 'dc+sd-jwt') {
        return this.matchSdJwt(cred, credQuery);
      }

      return false;
    });
  }

  private matchJwtVcJson(cred: VerifiableCredential, credQuery: DcqlCredentialQuery): boolean {
    const meta = credQuery.meta;
    const credDef = meta?.['credential_definition'] as Record<string, unknown> | undefined;
    if (!credDef?.['type']) return true;

    const requiredTypes = credDef['type'] as string[];
    return requiredTypes.every(t => cred.type?.includes(t as ExtendedCredentialType));
  }

  private matchSdJwt(cred: VerifiableCredential, credQuery: DcqlCredentialQuery): boolean {
    const meta = credQuery.meta;
    const vctValues = meta?.['vct_values'] as string[] | undefined;
    if (!vctValues) return true;

    return cred.type?.some(t => vctValues.includes(t)) ?? false;
  }
}
