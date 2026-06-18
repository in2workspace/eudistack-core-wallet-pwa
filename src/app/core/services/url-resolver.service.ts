import { Injectable, inject } from '@angular/core';
import { environment } from 'src/environments/environment';
import { TenantService } from './tenant.service';

/**
 * Computes the effective server base URL at call time, supporting both canonical
 * (known-tenant subdomain, e.g. tenant.stg.eudistack.net/business-wallet) and
 * non-canonical (custom domain, no path prefix — CloudFront handles routing) deployments.
 *
 * Priority:
 *  1. Explicit env value (dev / SERVER_URL deployment override) → returned as-is
 *  2. Canonical hostname (KNOWN_TENANTS) → origin + /business-wallet
 *  3. Non-canonical (custom domain) → origin only
 */
@Injectable({ providedIn: 'root' })
export class UrlResolverService {
  private readonly tenantService = inject(TenantService);

  serverUrl(): string {
    if (environment.server_url) return environment.server_url;
    return this.tenantService.isCanonicalDomain()
      ? `${window.location.origin}/business-wallet`
      : window.location.origin;
  }

  websocketUrl(): string {
    if (environment.websocket_url) return environment.websocket_url;
    const wsOrigin = window.location.origin.replace(/^http/, 'ws');
    return this.tenantService.isCanonicalDomain()
      ? `${wsOrigin}/business-wallet`
      : wsOrigin;
  }

  /**
   * Path to the wallet discovery well-known endpoint, relative to the current origin.
   * Canonical → /business-wallet/.well-known/wallet-config-metadata
   * Non-canonical → /.well-known/wallet-config-metadata (CloudFront exposes without prefix)
   */
  walletDiscoveryPath(): string {
    return this.tenantService.isCanonicalDomain()
      ? '/business-wallet/.well-known/wallet-config-metadata'
      : '/.well-known/wallet-config-metadata';
  }
}
