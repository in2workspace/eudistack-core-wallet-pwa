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
 * How first registrations work in the tenant (EUD-315, design §2.7).
 *
 * - `'open'`:       anyone can create an account with their email and a code.
 * - `'restricted'`: accounts are only created with an onboarding ticket; the
 *                   email flow only serves accounts that already exist.
 */
export type OnboardingMode = 'open' | 'restricted';

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
   * Key manager configured for this tenant (`'db'`, `'passkey-prf'`, `'hsm'`, `'qtsp'`),
   * or `null` when the source is `'fallback'` or the tenant has no key manager set.
   */
  keyManager: string | null;

  /**
   * Onboarding mode of the tenant (EUD-315). `'open'` when the metadata does not
   * carry it (older service) and in every fallback snapshot.
   */
  onboardingMode: OnboardingMode;

  /**
   * Tenant's onboarding address (where a user without a wallet gets one). Only
   * in `'restricted'` mode and only when it is a valid http(s) URL; `null` otherwise.
   */
  signupUrl: string | null;

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
 * Contract: { wallet_mode: 'browser'|'server', key_manager: string|null,
 *             onboarding_mode?: 'open'|'restricted', signup_url?: string } (EUD-315)
 * This DTO is used only inside the gateway layer; the rest of the application
 * works with `WalletDiscoverySnapshot`.
 */
export interface WalletConfigMetadataDto {
  wallet_mode: string;
  key_manager: string | null;
  /** EUD-315. Optional: older services do not send it. */
  onboarding_mode?: string;
  /** EUD-315. Only sent in `restricted` mode, when the tenant has one. */
  signup_url?: string | null;
}
