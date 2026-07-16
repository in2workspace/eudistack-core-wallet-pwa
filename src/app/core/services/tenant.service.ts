import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KNOWN_TENANTS, FALLBACK_TENANT } from '../constants/tenants.constants';
import { CustomDomainConfig } from '../models/custom-domain.model';

const WALLET_HOME_PATH = '/wallet/';
const ISSUER_PATH = '/issuer';
const CUSTOM_DOMAIN_CONFIG_URL = '/assets/tenants/custom-domain.json';

@Injectable({ providedIn: 'root' })
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly _tenant = signal<string | null>(null);

  private _resolvePromise: Promise<void> | null = null;
  private _customDomainConfigPromise: Promise<CustomDomainConfig> | null = null;

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

    const customDomainConfig = await this.loadCustomDomainConfig();
    const tenantFromCustomDomain = customDomainConfig.domains[normalizedHostname]?.tenantId;

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

  /**
   * Resolves the OID4VCI issuer base URL for the current host.
   *
   * Resolution rules:
   *  - Canonical known-tenant domains are served same-origin: nginx routes
   *    `/issuer/*` to the tenant's issuer backend, so the issuer lives at
   *    `${origin}/issuer`.
   *  - Custom domains do NOT proxy `/issuer` same-origin — hitting it returns
   *    the SPA's index.html. Their issuer host is declared in
   *    custom-domain.json under `tenants[tenantId].env[envId].issuer`.
   *
   * Falls back to `${origin}/issuer` when the custom-domain config has no
   * usable issuer entry (missing file, unknown host, empty value).
   */
  async resolveIssuerBaseUrl(location: Location = window.location): Promise<string> {
    const sameOriginIssuer = `${this.originOf(location)}${ISSUER_PATH}`;
    const hostname = location.hostname.toLowerCase();

    if (this.isCanonicalDomain(hostname)) {
      return sameOriginIssuer;
    }

    const config = await this.loadCustomDomainConfig();
    const entry = config.domains[hostname];
    const tenantConfig = entry ? config.tenants[entry.tenantId] : undefined;
    if (!tenantConfig) return sameOriginIssuer;

    const envId = entry?.envId || tenantConfig.defaultEnv;
    const issuer =
      tenantConfig.env?.[envId]?.issuer ??
      tenantConfig.env?.[tenantConfig.defaultEnv]?.issuer;

    if(issuer?.trim()){
      return issuer.replace(/\/+$/, '');
    }

    console.warn("TenantService: No issuer found for tenant", entry.tenantId, "env", envId, "- falling back to same-origin issuer");

    return sameOriginIssuer;
  }

  buildFallbackUrl(location: Location = window.location): string {
    const segments = location.hostname.split('.');
    const hasSubdomain = segments.length > 1;

    // The env now lives in the second segment (e.g. sandbox.stg.eudistack.net),
    // so replacing only the first segment preserves the environment.
    const targetHost = hasSubdomain
      ? [FALLBACK_TENANT, ...segments.slice(1)].join('.')
      : location.hostname;

    const port = location.port ? `:${location.port}` : '';
    return `${location.protocol}//${targetHost}${port}${WALLET_HOME_PATH}`;
  }

  private originOf(location: Location): string {
    const port = location.port ? `:${location.port}` : '';
    return `${location.protocol}//${location.hostname}${port}`;
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
    return hostname.split('.')[0].toLowerCase();
  }

  private loadCustomDomainConfig(): Promise<CustomDomainConfig> {
    if (!this._customDomainConfigPromise) {
      this._customDomainConfigPromise = firstValueFrom(
        this.http.get<CustomDomainConfig>(CUSTOM_DOMAIN_CONFIG_URL),
      ).catch(() => ({ domains: {}, tenants: {} }));
    }

    return this._customDomainConfigPromise;
  }
}