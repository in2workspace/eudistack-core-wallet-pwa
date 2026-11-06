/// <reference types="node" />
import { hkdfSync } from 'crypto';
import { p256 } from '@noble/curves/nist.js';
import { AppError } from '../models/error/AppError';
import { base64UrlDecode, base64UrlEncode } from './base64url';
import { deriveP256KeyFromBytes } from './p256-key-derivation.util';

// JSDOM does not implement crypto.subtle; polyfill with Node's built-in WebCrypto API.
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const INFO = 'eudistack:passkey-prf:p256:v1';
const NO_SALT = new Uint8Array(0);
/** Order n of P-256: not a valid private scalar. */
const CURVE_ORDER = Uint8Array.from(Buffer.from('FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551', 'hex'));

function prfOutput(fill: number): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

/** Independent computation of the expected public key: Node's HKDF and the noble curve. */
function expectedPublicJwk(ikm: Uint8Array, salt: Uint8Array, info: string): JsonWebKey {
  const d = new Uint8Array(hkdfSync('sha256', ikm, salt, info, 32));
  const point = p256.getPublicKey(d, false);
  return { kty: 'EC', crv: 'P-256', x: base64UrlEncode(point.slice(1, 33)), y: base64UrlEncode(point.slice(33, 65)) };
}

function infoOf(call: unknown[]): string {
  return new TextDecoder().decode((call[0] as HkdfParams).info as Uint8Array);
}

describe('deriveP256KeyFromBytes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('derives the public key HKDF-SHA-256 gives for the PRF output, the salt and the info', async () => {
    // Arrange
    const ikm = prfOutput(9);

    // Act
    const { publicKeyJwk } = await deriveP256KeyFromBytes(ikm, NO_SALT, INFO);

    // Assert
    expect(publicKeyJwk).toEqual(expectedPublicJwk(ikm, NO_SALT, INFO));
  });

  it('uses the salt it is given (browser mode keeps its own salt and info)', async () => {
    // Arrange
    const ikm = prfOutput(3);
    const salt = new TextEncoder().encode('eudistack:master:v1');

    // Act
    const { publicKeyJwk } = await deriveP256KeyFromBytes(ikm, salt, 'eudistack:p256:v1');

    // Assert
    expect(publicKeyJwk).toEqual(expectedPublicJwk(ikm, salt, 'eudistack:p256:v1'));
  });

  it('is deterministic: the same inputs give the same key', async () => {
    // Arrange
    const ikm = prfOutput(5);

    // Act
    const first = await deriveP256KeyFromBytes(ikm, NO_SALT, INFO);
    const second = await deriveP256KeyFromBytes(ikm, NO_SALT, INFO);

    // Assert
    expect(second.publicKeyJwk).toEqual(first.publicKeyJwk);
  });

  it('gives another key for another PRF output or another info', async () => {
    // Arrange
    const base = await deriveP256KeyFromBytes(prfOutput(1), NO_SALT, INFO);

    // Act
    const otherPrf = await deriveP256KeyFromBytes(prfOutput(2), NO_SALT, INFO);
    const otherInfo = await deriveP256KeyFromBytes(prfOutput(1), NO_SALT, 'eudistack:passkey-prf:p256:v2');

    // Assert
    expect(otherPrf.publicKeyJwk).not.toEqual(base.publicKeyJwk);
    expect(otherInfo.publicKeyJwk).not.toEqual(base.publicKeyJwk);
  });

  it('returns a public JWK without the private scalar', async () => {
    // Arrange
    const ikm = prfOutput(4);

    // Act
    const { publicKeyJwk } = await deriveP256KeyFromBytes(ikm, NO_SALT, INFO);

    // Assert
    expect(Object.keys(publicKeyJwk).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('returns a non-extractable key that can only sign, and its signatures verify with the public key', async () => {
    // Arrange
    const { privateKey, publicKeyJwk } = await deriveP256KeyFromBytes(prfOutput(6), NO_SALT, INFO);
    const data = new TextEncoder().encode('header.payload');

    // Act
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data);
    const publicKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, data);

    // Assert
    expect(privateKey.extractable).toBe(false);
    expect(privateKey.usages).toEqual(['sign']);
    expect(valid).toBe(true);
    await expect(crypto.subtle.exportKey('jwk', privateKey)).rejects.toBeDefined();
  });

  it('zero-fills the private scalar once the key is imported', async () => {
    // Arrange
    const scalar = new Uint8Array(32);
    scalar[31] = 1;
    const buffer = scalar.buffer;
    jest.spyOn(crypto.subtle, 'deriveBits').mockResolvedValue(buffer);

    // Act
    await deriveP256KeyFromBytes(prfOutput(1), NO_SALT, INFO);

    // Assert
    expect(Array.from(new Uint8Array(buffer))).toEqual(new Array(32).fill(0));
  });

  it('does not modify the PRF output it receives (the caller zero-fills it)', async () => {
    // Arrange
    const ikm = prfOutput(8);

    // Act
    await deriveP256KeyFromBytes(ikm, NO_SALT, INFO);

    // Assert
    expect(Array.from(ikm)).toEqual(new Array(32).fill(8));
  });

  describe('a scalar outside [1, n-1]', () => {
    function validScalar(): ArrayBuffer {
      const scalar = new Uint8Array(32);
      scalar[31] = 1;
      return scalar.buffer;
    }

    it('is derived again with a counter appended to info, and zero-filled', async () => {
      // Arrange
      const zero = new ArrayBuffer(32);
      const deriveBits = jest.spyOn(crypto.subtle, 'deriveBits')
        .mockResolvedValueOnce(zero)
        .mockResolvedValueOnce(validScalar());

      // Act
      const { publicKeyJwk } = await deriveP256KeyFromBytes(prfOutput(1), NO_SALT, INFO);

      // Assert
      expect(deriveBits).toHaveBeenCalledTimes(2);
      expect(infoOf(deriveBits.mock.calls[0])).toBe(INFO);
      expect(infoOf(deriveBits.mock.calls[1])).toBe(`${INFO}:1`);
      const one = new Uint8Array(32);
      one[31] = 1;
      const point = p256.getPublicKey(one, false);
      expect(publicKeyJwk.x).toBe(base64UrlEncode(point.slice(1, 33)));
    });

    it('treats the curve order as invalid too', async () => {
      // Arrange
      const deriveBits = jest.spyOn(crypto.subtle, 'deriveBits')
        .mockResolvedValueOnce(CURVE_ORDER.slice().buffer)
        .mockResolvedValueOnce(validScalar());

      // Act
      await deriveP256KeyFromBytes(prfOutput(1), NO_SALT, INFO);

      // Assert
      expect(deriveBits).toHaveBeenCalledTimes(2);
    });

    it('fails with an AppError when no attempt gives a valid scalar', async () => {
      // Arrange
      jest.spyOn(crypto.subtle, 'deriveBits').mockImplementation(() => Promise.resolve(new ArrayBuffer(32)));

      // Act
      const result = deriveP256KeyFromBytes(prfOutput(1), NO_SALT, INFO);

      // Assert
      await expect(result).rejects.toBeInstanceOf(AppError);
    });
  });

  it('decodes to the 32-byte coordinates of a P-256 point', async () => {
    // Arrange
    const { publicKeyJwk } = await deriveP256KeyFromBytes(prfOutput(7), NO_SALT, INFO);

    // Act
    const x = base64UrlDecode(publicKeyJwk.x as string);
    const y = base64UrlDecode(publicKeyJwk.y as string);

    // Assert
    expect(x).toHaveLength(32);
    expect(y).toHaveLength(32);
  });
});
