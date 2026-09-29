import { Injectable, Signal, computed, signal } from '@angular/core';
import { ExtendedCredentialType, LifeCycleStatus, VerifiableCredential } from '../../core/models/verifiable-credential';
import { DcqlClaimQuery, DcqlCredentialQuery, DcqlQuery } from '../../core/protocol/oid4vp/authorization-request.model';

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
    if (credDef?.['type']) {
      const requiredTypes = credDef['type'] as string[];
      if (!requiredTypes.every(t => cred.type?.includes(t as ExtendedCredentialType))) return false;
    }

    // jwt_vc_json wraps subject fields under credentialSubject, matching claim
    // paths declared against the credential's own top-level shape (e.g. "credentialSubject.mandate...").
    return this.matchesClaims(cred, credQuery.claims);
  }

  private matchSdJwt(cred: VerifiableCredential, credQuery: DcqlCredentialQuery): boolean {
    const meta = credQuery.meta;
    const vctValues = meta?.['vct_values'] as string[] | undefined;
    if (vctValues && !cred.type?.some(t => vctValues.includes(t))) return false;

    // dc+sd-jwt has no credentialSubject wrapper on the wire (subject claims sit
    // at the top level), so claim paths are declared relative to it directly —
    // resolve them starting one level into the wallet's normalized model.
    return this.matchesClaims(cred.credentialSubject, credQuery.claims);
  }

  /**
   * A DCQL credential is eligible only when every declared claim constraint is
   * satisfied. Claims that share the same array position (e.g. two claims both
   * pathed through "mandate.power.*") are required to be satisfied by the SAME
   * array element, not by two different, unrelated elements — otherwise an
   * employee with one power granting "Execute" and a different, unrelated power
   * granting "Onboarding" would wrongly look like they hold both together.
   */
  private matchesClaims(root: unknown, claims?: DcqlClaimQuery[]): boolean {
    if (!claims || claims.length === 0) return true;

    const standaloneClaims: DcqlClaimQuery[] = [];
    const groupsByArrayPath = new Map<string, { arrayPath: string[]; subClaims: { subPath: string[]; values?: unknown[] }[] }>();

    for (const claim of claims) {
      const wildcardIndex = claim.path.indexOf('*');
      if (wildcardIndex === -1) {
        standaloneClaims.push(claim);
        continue;
      }
      const arrayPath = claim.path.slice(0, wildcardIndex);
      const key = arrayPath.join('.');
      if (!groupsByArrayPath.has(key)) groupsByArrayPath.set(key, { arrayPath, subClaims: [] });
      groupsByArrayPath.get(key)!.subClaims.push({
        subPath: claim.path.slice(wildcardIndex + 1),
        values: claim.values,
      });
    }

    if (standaloneClaims.some(claim => !this.matchesClaimPath(root, claim.path, claim.values))) {
      return false;
    }

    for (const { arrayPath, subClaims } of groupsByArrayPath.values()) {
      const arrayNode = this.resolvePlainPath(root, arrayPath);
      if (!Array.isArray(arrayNode)) return false;
      const someElementSatisfiesAllSubClaims = arrayNode.some(element =>
        subClaims.every(sub => this.matchesClaimPath(element, sub.subPath, sub.values))
      );
      if (!someElementSatisfiesAllSubClaims) return false;
    }

    return true;
  }

  /** Walks plain (non-wildcard) object-key segments down to a nested node. */
  private resolvePlainPath(node: unknown, path: string[]): unknown {
    let current = node;
    for (const segment of path) {
      if (current === null || typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  /**
   * Walks `path` against `node`. The "*" segment means "match if ANY element of
   * the array at this position satisfies the rest of the path" — required to
   * express constraints like "some entry in mandate.power[] has function=Onboarding".
   */
  private matchesClaimPath(node: unknown, path: string[], values?: unknown[]): boolean {
    if (path.length === 0) {
      if (!values || values.length === 0) return node !== undefined && node !== null;
      const candidates = Array.isArray(node) ? node : [node];
      return candidates.some(value => values.includes(value));
    }

    const [segment, ...rest] = path;

    if (segment === '*') {
      return Array.isArray(node) && node.some(item => this.matchesClaimPath(item, rest, values));
    }

    if (node === null || typeof node !== 'object') return false;
    return this.matchesClaimPath((node as Record<string, unknown>)[segment], rest, values);
  }
}
