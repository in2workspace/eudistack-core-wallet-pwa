/**
 * Shared KDF parameters for hybrid wrap/unwrap operations.
 *
 * Both WrapService (US-02) and UnwrapService (US-04) MUST use the same info string
 * and hash; any divergence causes systematic AES-GCM tag verification failures (DELTA-01).
 *
 * Spec: EUDISTACK-536 AC-02; architecture.md §8.2 DELTA-01 binding.
 */
export const HKDF_INFO = new TextEncoder().encode('hybrid-wrap-v1');

export const HYBRID_WRAP_KDF_PARAMS = {
  hash: 'SHA-256',
  info: HKDF_INFO,
  aesLength: 256,
} as const;
