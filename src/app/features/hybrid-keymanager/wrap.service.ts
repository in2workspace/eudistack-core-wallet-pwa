import { Injectable } from '@angular/core';
import { HYBRID_WRAP_KDF_PARAMS } from './hybrid-kdf.const';

export interface HolderKeyPair {
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export interface WrappedKeyMaterial {
  wrappedBlob: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}

/**
 * Client-side cryptographic operations for hybrid onboarding.
 *
 * Key invariants (spec §AC-02/AC-03/NFR-04):
 *  - Private key never leaves the device in plaintext.
 *  - `publicKeyJwk` returned in HolderKeyPair MUST NOT contain "d".
 *  - AES-256-GCM: IV=12 bytes (random), tag=16 bytes (last bytes of SubtleCrypto output).
 *  - HKDF-SHA-256: salt=credentialId UTF-8 bytes, info="hybrid-wrap-v1", L=256 bits.
 *
 * Spec: EUDISTACK-534 AC-02, AC-03, AC-05; technical-design.md §3.2 T14.
 */
@Injectable({ providedIn: 'root' })
export class WrapService {

  async generateHolderKeyPair(): Promise<HolderKeyPair> {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable — needed for wrapping the private key
      ['sign', 'verify'],
    );

    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    // Defensive: public key JWK must never contain "d"
    delete (publicKeyJwk as Record<string, unknown>)['d'];

    return { privateKey: keyPair.privateKey, publicKeyJwk };
  }

  async deriveWrapKey(prfOutput: Uint8Array, credentialId: string): Promise<CryptoKey> {
    const baseKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(prfOutput),
      { name: 'HKDF' },
      false,
      ['deriveKey'],
    );

    const salt = new TextEncoder().encode(credentialId);

    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: HYBRID_WRAP_KDF_PARAMS.hash, salt, info: HYBRID_WRAP_KDF_PARAMS.info },
      baseKey,
      { name: 'AES-GCM', length: HYBRID_WRAP_KDF_PARAMS.aesLength },
      false, // wrap key is not extractable
      // Both usages: this key is cached in MemoryService keyed by credentialId and reused
      // as-is by SignService.sign() (US-04) to unwrap the same private key later in the
      // same TTL window — a single-usage key here throws InvalidAccessError on that path
      // (key.usages does not permit this operation), misreported downstream as a GCM tag
      // failure. See UnwrapService.deriveUnwrapKey (mirrors this for the derive-fresh path).
      ['wrapKey', 'unwrapKey'],
    );
  }

  async wrapPrivateKey(privateKey: CryptoKey, wrapKey: CryptoKey): Promise<WrappedKeyMaterial> {
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await crypto.subtle.wrapKey(
      'pkcs8',
      privateKey,
      wrapKey,
      { name: 'AES-GCM', iv, tagLength: 128 },
    );

    // SubtleCrypto AES-GCM output = ciphertext || 16-byte authentication tag
    const encrypted = new Uint8Array(encryptedBuffer);
    const tagOffset = encrypted.byteLength - 16;
    const wrappedBlob = encrypted.slice(0, tagOffset);
    const tag = encrypted.slice(tagOffset);

    return { wrappedBlob, iv, tag };
  }

  /**
   * Best-effort only: `SubtleCrypto.deleteKey` is not implemented by any mainstream browser
   * today, so this is currently a no-op in production (`deleteKey?.(k) ?? Promise.resolve()`).
   * The real security guarantee is that every key passed here is `extractable: false` — raw
   * key bytes never exist in JS-reachable memory in the first place, so there is nothing to
   * "leak" even though the CryptoKey object itself lingers until GC. Do not treat this method
   * as a hard "clears memory" guarantee; treat it as a hint for engines that do implement
   * `deleteKey`, on top of the non-extractability that actually carries the invariant.
   */
  async zeroize(...keys: CryptoKey[]): Promise<void> {
    const subtle = crypto.subtle as SubtleCrypto & { deleteKey?: (key: CryptoKey) => Promise<void> };
    await Promise.allSettled(keys.map(k => subtle.deleteKey?.(k) ?? Promise.resolve()));
  }
}