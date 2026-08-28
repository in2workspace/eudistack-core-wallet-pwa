import { Injectable, Signal, computed, signal } from '@angular/core';
import { ExtendedCredentialType, LifeCycleStatus, VerifiableCredential } from '../../core/models/verifiable-credential';
import { DcqlCredentialQuery, DcqlQuery } from '../../core/protocol/oid4vp/authorization-request.model';

const SCOPE_TO_TYPE: Record<string, string> = {
  'learcredential.employee': 'learcredential.employee.w3c.4',
  'learcredential.machine': 'learcredential.machine.w3c.3',
};

export type CredentialLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export interface CredentialState {
  status: CredentialLoadStatus;
  credentials: VerifiableCredential[];
}

/**
 * Single reactive source of truth for the wallet credential list.
 *
 * State is held in a signal (project convention: signals for local state).
 * `WalletService` owns the I/O and pushes state here via the mutators; the
 * credentials page reads the derived signals, and the OID4VP flow filters over
 * `snapshot()`. `status` lets consumers distinguish "loading" / "load error" /
 * "genuinely empty" instead of collapsing all three into an empty array.
 */
@Injectable({
  providedIn: 'root'
})
export class CredentialCacheService {

  private readonly _state = signal<CredentialState>({ status: 'idle', credentials: [] });

  readonly credentials: Signal<VerifiableCredential[]> = computed(() => [...this._state().credentials]);
  readonly status: Signal<CredentialLoadStatus> = computed(() => this._state().status);

  /** Synchronous snapshot of the current state (for imperative reads, e.g. VP filtering). */
  snapshot(): CredentialState {
    return this._state();
  }

  setLoading(): void {
    this._state.update(s => ({ status: 'loading', credentials: s.credentials }));
  }

  setLoaded(credentials: VerifiableCredential[]): void {
    this._state.set({ status: 'loaded', credentials: [...credentials] });
  }

  /** Marks a failed load WITHOUT clearing the current list — a transient error must not blank the wallet. */
  setError(): void {
    this._state.update(s => ({ status: 'error', credentials: s.credentials }));
  }

  patchStatus(id: string, lifeCycleStatus: LifeCycleStatus): void {
    this._state.update(s => ({
      status: s.status,
      credentials: s.credentials.map(cred =>
        cred.id === id ? { ...cred, lifeCycleStatus } : cred
      ),
    }));
  }

  remove(id: string): void {
    this._state.update(s => ({
      status: s.status,
      credentials: s.credentials.filter(cred => cred.id !== id),
    }));
  }

  getAll(): VerifiableCredential[] {
    return [...this._state().credentials];
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

    return this._state().credentials.filter(
      cred => cred.lifeCycleStatus === 'VALID' &&
        cred.type?.some(t => types.includes(t))
    );
  }

  extractSignedJwt(credential: VerifiableCredential): string | undefined {
    return credential.credentialEncoded;
  }

  private matchCredentialQuery(credQuery: DcqlCredentialQuery): VerifiableCredential[] {
    return this._state().credentials.filter(cred => {
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
