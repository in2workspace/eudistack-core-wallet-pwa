import { InjectionToken } from '@angular/core';
import { Observable } from 'rxjs';

import { WalletConfigMetadataDto } from '../models/wallet-discovery.model';

/**
 * Port (application layer) for fetching the tenant wallet configuration
 * from the public discovery endpoint.
 *
 * `GET /business-wallet/.well-known/wallet-config-metadata` (EUDISTACK-412)
 *
 * Separating HTTP access from `WalletDiscoveryService` allows tests to replace
 * the gateway with a fake/stub without touching `HttpClient` or `environment.ts`
 * (AC-009.6b, AC-009.6c).
 *
 * Implementations:
 *  - Production: `HttpWalletDiscoveryGateway` (Task 3)
 *  - Tests:      inline fake via `{ provide: WALLET_DISCOVERY_GATEWAY, useValue: fakeGateway }`
 */
export interface WalletDiscoveryGateway {
  /**
   * Emits the raw well-known response DTO exactly once, then completes.
   *
   * The observable MAY error with `HttpErrorResponse` (network / HTTP errors)
   * or `TimeoutError` (WALLET_DISCOVERY_TIMEOUT_MS exceeded).
   * `WalletDiscoveryService` is responsible for catching all errors and
   * applying the fallback chain (AC-009.4).
   */
  fetch(): Observable<WalletConfigMetadataDto>;
}

/**
 * DI token for `WalletDiscoveryGateway`.
 *
 * Register in providers:
 * ```ts
 * { provide: WALLET_DISCOVERY_GATEWAY, useClass: HttpWalletDiscoveryGateway }
 * ```
 *
 * Override in tests:
 * ```ts
 * { provide: WALLET_DISCOVERY_GATEWAY, useValue: fakeGateway }
 * ```
 */
export const WALLET_DISCOVERY_GATEWAY = new InjectionToken<WalletDiscoveryGateway>(
  'WALLET_DISCOVERY_GATEWAY',
);
