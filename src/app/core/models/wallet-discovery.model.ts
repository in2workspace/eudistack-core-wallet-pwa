/**
 * Domain models for wallet mode discovery (EUDISTACK-502).
 *
 * These types are pure domain — no framework imports. They model the result of
 * querying the wallet-config-metadata well-known endpoint (EUDISTACK-412).
 * Falls back when that endpoint is unavailable.
 */

/**
 * The two operating modes a wallet tenant can be configured for.
 *
 * - `'browser'`: client-side (EUDIW) — passkey-only auth, local credential storage.
 * - `'server'`: server-side (EBW)   — remote auth + credential storage in eudistack-core-wallet-ebw.
 */
export type WalletMode = 'browser' | 'server';

/**
 * Reason why the discovery fell back to `environment.wallet_mode` instead of
 * using the live well-known response.
 *
 * - `'network_error'`       — fetch failed (DNS, connection refused, CORS preflight).
 * - `'http_error'`          — endpoint returned a non-200 status (404, 5xx, …).
 * - `'timeout'`             — endpoint did not respond within WALLET_DISCOVERY_TIMEOUT_MS (2 s).
 * - `'invalid_payload'`     — response was HTTP 200 but the body failed shape validation.
 * - `'invalid_env_fallback'`— environment.wallet_mode contained an unrecognised value.
 * - `'fallback_default'`    — both the well-known and environment.wallet_mode were unavailable;
 *                             the safe default `'browser'` was applied (AD-5).
 */
export type WalletDiscoveryFallbackReason =
  | 'network_error'
  | 'http_error'
  | 'timeout'
  | 'invalid_payload'
  | 'invalid_env_fallback'
  | 'fallback_default';

/**
 * Immutable snapshot of a completed wallet mode discovery attempt.
 *
 * Persisted in the `WalletDiscoveryService` signal after the APP_INITIALIZER
 * resolves. All consumers downstream read from this snapshot synchronously.
 */
export interface WalletDiscoverySnapshot {
  /** Resolved operating mode for this session. */
  mode: WalletMode;

  /**
   * How the mode was resolved.
   *
   * - `'discovery'`: well-known endpoint returned a valid 200 response.
   * - `'fallback'`:  endpoint was unreachable / invalid; `environment.wallet_mode` was used.
   */
  source: 'discovery' | 'fallback';

  /**
   * Key manager configured for this tenant (`'db'`, `'hybrid'`, `'hsm'`, `'qtsp'`),
   * or `null` when the source is `'fallback'` or the tenant has no key manager set.
   */
  keyManager: string | null;

  /** `Date.now()` timestamp (ms) at the moment the snapshot was committed. */
  resolvedAt: number;

  /**
   * Present only when `source === 'fallback'`. Identifies why the well-known
   * endpoint could not be used as authoritative source.
   */
  fallbackReason?: WalletDiscoveryFallbackReason;
}

/**
 * Data-transfer object that mirrors the JSON body of
 * `GET /.well-known/wallet-config-metadata` (EUDISTACK-413 contract).
 *
 * Contract: { wallet_mode: 'browser'|'server', key_manager: string|null }
 * This DTO is used only inside the gateway layer; the rest of the application
 * works with `WalletDiscoverySnapshot`.
 */
export interface WalletConfigMetadataDto {
  wallet_mode: string;
  key_manager: string | null;
}
