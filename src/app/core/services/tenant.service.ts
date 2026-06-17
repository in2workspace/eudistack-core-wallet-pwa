import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KNOWN_TENANTS, FALLBACK_TENANT } from '../constants/tenants.constants';

const ENV_SUFFIXES = ['-stg', '-dev', '-pre'] as const;
const WALLET_HOME_PATH = '/wallet/';
const CUSTOM_DOMAIN_CONFIG_URL = '/assets/tenants/custom-domain.json';

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly _tenant = signal<string | null>(null);

  private _resolvePromise: Promise<void> | null = null;
  private _customDomainMapPromise: Promise<Record<string, string>> | null = null;

  /** Resolved tenant id, or null if the hostname could not be mapped to a known tenant. */
  readonly tenant = this._tenant.asReadonly();

  /**
   * Resolves the tenant for the current hostname and stores it in the signal.
   * Memoised: subsequent calls return the same Promise without re-running.
   *
   * Resolution order:
   *  1. Hostname-based mapping
   *  2. Custom-domain mapping via /assets/tenants/custom-domain.json
   *  3. null
   */
  resolve(): Promise<void> {
    if (this._resolvePromise) return this._resolvePromise;
    this._resolvePromise = this._doResolve();
    return this._resolvePromise;
  }

  /**
   * Resolves a tenant from a URL using the same rules as the app bootstrap.
   */
  async resolveTenantIdFromUrl(url: string): Promise<string | null> {
    try {
      return this.resolveTenantIdFromHostname(new URL(url).hostname);
    } catch {
      return null;
    }
  }

  /**
   * Resolves a tenant from a hostname using the same rules as the app bootstrap.
   */
  async resolveTenantIdFromHostname(hostname: string): Promise<string | null> {
    const normalizedHostname = hostname.toLowerCase();

    const tenantFromHostname = this.resolveKnownTenantFromHostname(normalizedHostname);
    if (tenantFromHostname) {
      return tenantFromHostname;
    }

    const customDomainMap = await this.loadCustomDomainMap();
    const tenantFromCustomDomain = customDomainMap[normalizedHostname];

    return tenantFromCustomDomain && KNOWN_TENANTS.includes(tenantFromCustomDomain)
      ? tenantFromCustomDomain
      : null;
  }

  /**
   * Kept for sync use cases where custom-domain resolution is intentionally not needed.
   * Prefer resolveTenantIdFromHostname when validating real external URLs.
   */
  extractTenantIdFromHostname(hostname: string): string | null {
    if (!hostname.includes('.')) return null;
    return this.extractBaseTenantFromHostname(hostname);
  }

  /**
   * Returns true when the current hostname is a known-tenant subdomain (canonical deployment).
   * Returns false for custom domains resolved via custom-domain.json.
   */
  isCanonicalDomain(hostname = window.location.hostname): boolean {
    return this.resolveKnownTenantFromHostname(hostname.toLowerCase()) !== null;
  }

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
    const tenantId = await this.resolveTenantIdFromHostname(window.location.hostname);
    this._tenant.set(tenantId);
  }

  private resolveKnownTenantFromHostname(hostname: string): string | null {
    const tenantId = this.extractBaseTenantFromHostname(hostname);
    return KNOWN_TENANTS.includes(tenantId) ? tenantId : null;
  }

  private extractBaseTenantFromHostname(hostname: string): string {
    const first = hostname.split('.')[0].toLowerCase();
    return this.stripEnvSuffix(first).base;
  }

  private loadCustomDomainMap(): Promise<Record<string, string>> {
    if (!this._customDomainMapPromise) {
      this._customDomainMapPromise = firstValueFrom(
        this.http.get<Record<string, string>>(CUSTOM_DOMAIN_CONFIG_URL),
      ).catch(() => ({}));
    }

    return this._customDomainMapPromise;
  }

  private stripEnvSuffix(tenant: string): { base: string; suffix: string } {
    const match = ENV_SUFFIXES.find((s) => tenant.endsWith(s));
    return match
      ? { base: tenant.slice(0, -match.length), suffix: match }
      : { base: tenant, suffix: '' };
  }
}