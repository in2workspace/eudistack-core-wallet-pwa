import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KNOWN_TENANTS, FALLBACK_TENANT } from '../constants/tenants.constants';

const ENV_SUFFIXES = ['-stg', '-dev', '-pre'] as const;
const WALLET_HOME_PATH = '/wallet/';

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly _tenant = signal<string | null>(null);
  private _resolvePromise: Promise<void> | null = null;

  /** Resolved tenant id, or null if the hostname could not be mapped to a known tenant. */
  readonly tenant = this._tenant.asReadonly();

  /**
   * Resolves the tenant for the current hostname and stores it in the signal.
   * Memoised: subsequent calls return the same Promise without re-running.
   *
   * Resolution order:
   *  1. Hostname-based (first DNS label → strip env suffix → match KNOWN_TENANTS)
   *  2. Custom-domain mapping via /assets/custom-domain.json
   *  3. null — unknown tenant; consumers should redirect to /tenant-not-found
   */
  resolve(): Promise<void> {
    if (this._resolvePromise) return this._resolvePromise;
    this._resolvePromise = this._doResolve();
    return this._resolvePromise;
  }

  /**
   * Builds the fallback URL for the sandbox tenant based on the supplied location.
   * Replaces the first hostname segment with "sandbox" and preserves the environment
   * suffix (-stg/-dev/-pre) so STG users don't accidentally jump into PROD.
   */
  buildFallbackUrl(location: Location = window.location): string {
    const segments = location.hostname.split('.');
    const hasSubdomain = segments.length > 1;

    let targetHost: string;
    if (hasSubdomain) {
      const { suffix } = this.stripEnvSuffix(segments[0].toLowerCase());
      targetHost = [`${FALLBACK_TENANT}${suffix}`, ...segments.slice(1)].join('.');
    } else {
      targetHost = location.hostname;
    }

    const port = location.port ? `:${location.port}` : '';
    return `${location.protocol}//${targetHost}${port}${WALLET_HOME_PATH}`;
  }

  private async _doResolve(): Promise<void> {
    if (this.isKnownHostname(window.location.hostname)) {
      this._tenant.set(this.resolveTenantFromHostname(window.location.hostname));
      return;
    }

    try {
      const map = await firstValueFrom(
        this.http.get<Record<string, string>>('/assets/custom-domain.json'),
      );
      const tenantId = map[window.location.hostname];
      if (tenantId && KNOWN_TENANTS.includes(tenantId)) {
        this._tenant.set(tenantId);
        return;
      }
    } catch {
      // File absent or network error — fall through to null
    }

    this._tenant.set(null);
  }

  private resolveTenantFromHostname(hostname: string): string {
    const first = hostname.split('.')[0].toLowerCase();
    return this.stripEnvSuffix(first).base;
  }

  private isKnownHostname(hostname: string): boolean {
    return KNOWN_TENANTS.includes(this.resolveTenantFromHostname(hostname));
  }

  private stripEnvSuffix(tenant: string): { base: string; suffix: string } {
    const match = ENV_SUFFIXES.find((s) => tenant.endsWith(s));
    return match
      ? { base: tenant.slice(0, -match.length), suffix: match }
      : { base: tenant, suffix: '' };
  }
}
