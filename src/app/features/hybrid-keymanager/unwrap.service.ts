import { Injectable } from '@angular/core';
import { HybridAdapterError } from 'src/app/core/models/error/HybridAdapterError';
import { HYBRID_WRAP_KDF_PARAMS } from './hybrid-kdf.const';

/**
 * Client-side AES-256-GCM unwrap of the holder's ECDSA P-256 private key.
 *
 * Mirrors WrapService (US-02) with the usage flipped to ['unwrapKey']. The HKDF
 * parameters (SHA-256, salt=UTF8(credentialId), info='hybrid-wrap-v1', L=256) MUST
 * match US-02's wrap exactly — any divergence causes systematic GCM-tag failure
 * (DELTA-01 binding; architecture.md §8.2).
 *
 * Spec: EUDISTACK-536 AC-02, AC-04, AC-06, ES-03; technical-design.md §3.2 T10.
 */
@Injectable({ providedIn: 'root' })
export class UnwrapService {

  /**
   * Derives the AES-256-GCM unwrap key from the PRF output.
   *
   * Mirrors WrapService.deriveWrapKey with usage=['unwrapKey']. The salt MUST be
   * UTF-8(credentialId) to match the wrap-side derivation (DELTA-01).
   */
  async deriveUnwrapKey(prfOutput: Uint8Array, credentialId: string): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      prfOutput,
      { name: 'HKDF' },
      false,
      ['deriveKey'],
    );

    const salt = new TextEncoder().encode(credentialId);

    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: HYBRID_WRAP_KDF_PARAMS.hash, salt, info: HYBRID_WRAP_KDF_PARAMS.info },
      baseKey,
      { name: 'AES-GCM', length: HYBRID_WRAP_KDF_PARAMS.aesLength },
      false,
      // Both usages, symmetric with WrapService.deriveWrapKey — this key is cached in
      // MemoryService keyed by credentialId and may be reused by a later wrap operation
      // within the same TTL window (e.g. re-enrollment). See that method for the incident
      // this fixes (InvalidAccessError misreported as a GCM tag failure).
      ['wrapKey', 'unwrapKey'],
    );
  }

  /**
   * Unwraps the holder's ECDSA P-256 private key from the AES-256-GCM ciphertext.
   *
   * US-02 stores the output of wrapKey as ciphertext || 16-byte-tag split into separate
   * fields. Reconstruct the concatenated buffer (required by SubtleCrypto.unwrapKey)
   * before calling the API. The result is non-extractable and usable only for signing.
   *
   * @throws {HybridAdapterError} code='wrap_unavailable_on_this_device' if the GCM tag
   *   fails (wrong device, wrong salt, or corrupted blob). AC-06 / ES-03: fail-closed —
   *   the submit call is never made if unwrap fails.
   */
  async unwrap(
    wrappedBlob: Uint8Array,
    iv: Uint8Array,
    tag: Uint8Array,
    unwrapKey: CryptoKey,
  ): Promise<CryptoKey> {
    // Reconstruct the AES-GCM output: ciphertext || authentication_tag
    const encrypted = new Uint8Array(wrappedBlob.byteLength + tag.byteLength);
    encrypted.set(wrappedBlob, 0);
    encrypted.set(tag, wrappedBlob.byteLength);

    try {
      return await crypto.subtle.unwrapKey(
        'pkcs8',
        encrypted,
        unwrapKey,
        { name: 'AES-GCM', iv, tagLength: 128 },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,      // non-extractable — private key never leaves SubtleCrypto
        ['sign'],
      );
    } catch (cause) {
      // WebCrypto throws OperationError specifically for a failed AES-GCM auth tag —
      // that is the genuine "wrong device / corrupted blob" case. Anything else (e.g.
      // InvalidAccessError from a key.usages mismatch) is a programming error, not a
      // device/passkey mismatch — mislabeling it here sends holders down the wrong
      // recovery path (re-sync passkey) for a bug that syncing can never fix.
      // Duck-typed on `.name` (not `instanceof DOMException`) — Node's webcrypto and
      // jsdom's DOMException are distinct constructors in the Jest test environment.
      if ((cause as { name?: string } | undefined)?.name === 'OperationError') {
        throw new HybridAdapterError('GCM tag invalid — wrong device or corrupted key material', {
          code: 'wrap_unavailable_on_this_device',
          cause,
          translationKey: 'hybrid-errors.wrap-unavailable-body',
        });
      }
      throw new HybridAdapterError('Unwrap failed for a reason other than an invalid GCM tag', {
        code: 'prepare_sign_failed',
        cause,
      });
    }
  }
}
