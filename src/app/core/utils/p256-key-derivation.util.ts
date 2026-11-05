import { p256 } from '@noble/curves/nist.js';
import { AppError } from '../models/error/AppError';
import { base64UrlEncode } from './base64url';

/** The retry counter only matters when `d` falls outside [1, n-1], which has a negligible probability. */
const MAX_DERIVATION_ATTEMPTS = 8;

export interface DerivedP256Key {
  /** Non-extractable: it can only sign. */
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

/**
 * Derives a P-256 signing key from the output of the passkey PRF: HKDF-SHA-256 gives 32 bytes, which are
 * the private scalar `d` (the HKDF hash is not the curve). When `d` is not in [1, n-1] the derivation is
 * repeated with a counter appended to `info`.
 *
 * The scalar and its buffer are zero-filled as soon as the key is imported. The caller owns `prfOutput`
 * and must zero-fill it.
 */
export async function deriveP256KeyFromBytes(
  prfOutput: Uint8Array,
  salt: Uint8Array,
  info: string
): Promise<DerivedP256Key> {
  const masterKey = await globalThis.crypto.subtle.importKey(
    'raw',
    prfOutput.slice(), // .slice() ensures ArrayBuffer-backed Uint8Array
    'HKDF',
    false,
    ['deriveBits']
  );

  for (let attempt = 0; attempt < MAX_DERIVATION_ATTEMPTS; attempt++) {
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        salt: salt.slice(),
        hash: 'SHA-256',
        info: new TextEncoder().encode(attempt === 0 ? info : `${info}:${attempt}`).slice(),
      },
      masterKey,
      256
    );

    const d = new Uint8Array(derivedBits);
    try {
      if (!p256.utils.isValidSecretKey(d)) {
        continue;
      }
      return await importP256Key(d);
    } finally {
      d.fill(0);
    }
  }

  throw new AppError('P-256 key derivation did not produce a valid private key');
}

async function importP256Key(d: Uint8Array): Promise<DerivedP256Key> {
  const publicKeyUncompressed = p256.getPublicKey(d, false); // 65 bytes: 04 || x || y
  const x = base64UrlEncode(publicKeyUncompressed.slice(1, 33));
  const y = base64UrlEncode(publicKeyUncompressed.slice(33, 65));

  const privateKey = await globalThis.crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d: base64UrlEncode(d), x, y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, // non-extractable
    ['sign']
  );

  return { privateKey, publicKeyJwk: { kty: 'EC', crv: 'P-256', x, y } };
}
