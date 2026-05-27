import { HttpClient, HttpContext } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { WALLET_DISCOVERY_PATH } from '../constants/api.constants';
import { WalletConfigMetadataDto } from '../models/wallet-discovery.model';
import { WalletDiscoveryGateway } from './wallet-discovery.gateway';

/**
 * Time in milliseconds before a pending well-known fetch is cancelled.
 *
 * Defined here (not in `WalletDiscoveryService`) so that tests of the gateway
 * can assert timeout behaviour without depending on the service (AC-009.4c).
 */
export const WALLET_DISCOVERY_TIMEOUT_MS = 2000 as const;

/**
 * Validates that an unknown value matches the `WalletConfigMetadataDto` shape.
 *
 * Used by `WalletDiscoveryService` (Task 4) to guard against malformed 200
 * responses before they reach domain logic (AC-009.4d, AD-4).
 *
 * Rules:
 *  - Value must be a non-null plain object (not an array).
 *  - `wallet_mode` must be the string `'browser'` or `'server'`.
 *  - `key_manager` must be a string, null, or absent (EUDISTACK-413 contract).
 */
export function isValidWalletConfigMetadataDto(value: unknown): value is WalletConfigMetadataDto {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    (candidate['wallet_mode'] === 'browser' || candidate['wallet_mode'] === 'server') &&
    (candidate['key_manager'] === undefined ||
      candidate['key_manager'] === null ||
      typeof candidate['key_manager'] === 'string')
  );
}

/**
 * HTTP adapter that implements `WalletDiscoveryGateway` (AC-009.6b).
 *
 * Emits a single GET request to the EBW public well-known endpoint and
 * applies a 2-second defensive timeout (AC-009.4c).
 *
 * Headers sent:
 *  - `Accept: application/json`
 *  - NO `Authorization` or `X-Tenant-Id` (endpoint is public — EUDISTACK-412 AC-1)
 *  - NO `withCredentials` (AC-009.1c)
 *
 * The `Host` header is added automatically by the browser — the gateway MUST
 * NOT set it manually (forbidden by the Fetch spec, AC-009.1b).
 *
 * Observable contract:
 *  - Emits the raw `WalletConfigMetadataDto` body exactly once, then completes.
 *  - Errors with `HttpErrorResponse` on network / HTTP errors.
 *  - Errors with `TimeoutError` if the endpoint does not respond within
 *    `WALLET_DISCOVERY_TIMEOUT_MS` milliseconds.
 *
 * Payload validation (`isValidWalletConfigMetadataDto`) is intentionally left
 * to the caller (`WalletDiscoveryService`) so that the gateway only deals with
 * HTTP concerns.
 */
@Injectable()
export class HttpWalletDiscoveryGateway implements WalletDiscoveryGateway {
  private readonly http = inject(HttpClient);

  fetch(): Observable<WalletConfigMetadataDto> {
    const url = `${window.location.origin}${WALLET_DISCOVERY_PATH}`;

    return this.http
      .get<WalletConfigMetadataDto>(url, {
        headers: { Accept: 'application/json' },
        context: new HttpContext(),
        withCredentials: false,
      })
      .pipe(timeout(WALLET_DISCOVERY_TIMEOUT_MS));
  }
}
