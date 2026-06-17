import { Injectable } from '@angular/core';

export interface HolderKeyPair {
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

export interface WrappedKeyMaterial {
  wrappedBlob: Uint8Array;
  iv: Uint8Array;
  tag: Uint8Array;
}

const HKDF_INFO = new TextEncoder().encode('hybrid-wrap-v1');

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
      { name: 'HKDF', hash: 'SHA-256', salt, info: HKDF_INFO },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false, // wrap key is not extractable
      ['wrapKey'],
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

  async zeroize(...keys: CryptoKey[]): Promise<void> {
    const subtle = crypto.subtle as SubtleCrypto & { deleteKey?: (key: CryptoKey) => Promise<void> };
    await Promise.allSettled(keys.map(k => subtle.deleteKey?.(k) ?? Promise.resolve()));
  }
}