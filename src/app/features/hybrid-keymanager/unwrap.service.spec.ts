/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { HybridAdapterError } from 'src/app/core/models/error/HybridAdapterError';
import { UnwrapService } from './unwrap.service';
import { WrapService } from './wrap.service';

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

/**
 * Tests for UnwrapService cryptographic operations.
 *
 * The round-trip test (wrap then unwrap) validates the DELTA-01 KDF binding —
 * both services must derive the same AES-256-GCM key from the same PRF output
 * and credentialId, or the GCM tag verification will fail.
 *
 * Spec: EUDISTACK-536 AC-01, AC-02, AC-06, ES-03; technical-design.md §3.2 T14.
 */
describe('UnwrapService', () => {
  let wrapSvc: WrapService;
  let unwrapSvc: UnwrapService;
  let PRF_OUTPUT: Uint8Array;

  const CREDENTIAL_ID = 'cred-unwrap-test-001';

  beforeEach(() => {
    PRF_OUTPUT = crypto.getRandomValues(new Uint8Array(32)); // fresh random bytes per test (N5)
    TestBed.configureTestingModule({});
    wrapSvc = TestBed.inject(WrapService);
    unwrapSvc = TestBed.inject(UnwrapService);
  });

  // ------------------------------------------------------------------ DELTA-01 round-trip (AC-01/AC-02)

  it('round-trip: wrap then unwrap recovers a usable ECDSA signing key', async () => {
    const { privateKey, publicKeyJwk } = await wrapSvc.generateHolderKeyPair();
    const wrapKey = await wrapSvc.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const { wrappedBlob, iv, tag } = await wrapSvc.wrapPrivateKey(privateKey, wrapKey);

    const unwrapKey = await unwrapSvc.deriveUnwrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const holderKey = await unwrapSvc.unwrap(wrappedBlob, iv, tag, unwrapKey);

    // Verify the recovered key works: sign then verify against the public JWK
    const message = new TextEncoder().encode('test-signing-input.test-payload');
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, holderKey, message);

    const pubKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, signature, message);

    expect(valid).toBe(true);
    expect(holderKey.extractable).toBe(false);
    expect(holderKey.usages).toContain('sign');

    await wrapSvc.zeroize(privateKey, wrapKey, holderKey, unwrapKey);
  });

  // ------------------------------------------------------------------ wrong salt → GCM tag failure (AC-02/AC-06/ES-03)

  it('deriveUnwrapKey with wrong credentialId causes unwrap to throw HybridAdapterError', async () => {
    const { privateKey } = await wrapSvc.generateHolderKeyPair();
    const wrapKey = await wrapSvc.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const { wrappedBlob, iv, tag } = await wrapSvc.wrapPrivateKey(privateKey, wrapKey);

    // Derive unwrap key with a DIFFERENT credentialId (wrong salt → wrong key → GCM tag fail)
    const wrongUnwrapKey = await unwrapSvc.deriveUnwrapKey(PRF_OUTPUT, 'wrong-credential-id');

    await expect(unwrapSvc.unwrap(wrappedBlob, iv, tag, wrongUnwrapKey))
      .rejects.toMatchObject({
        code: 'wrap_unavailable_on_this_device',
      } satisfies Partial<HybridAdapterError>);

    await wrapSvc.zeroize(privateKey, wrapKey, wrongUnwrapKey);
  });

  // ------------------------------------------------------------------ corrupted tag → GCM tag failure (ES-03)

  it('corrupted authentication tag causes unwrap to throw HybridAdapterError', async () => {
    const { privateKey } = await wrapSvc.generateHolderKeyPair();
    const wrapKey = await wrapSvc.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const { wrappedBlob, iv, tag } = await wrapSvc.wrapPrivateKey(privateKey, wrapKey);

    const corruptedTag = new Uint8Array(tag);
    corruptedTag[0] ^= 0xff; // flip bits in first byte

    const unwrapKey = await unwrapSvc.deriveUnwrapKey(PRF_OUTPUT, CREDENTIAL_ID);

    await expect(unwrapSvc.unwrap(wrappedBlob, iv, corruptedTag, unwrapKey))
      .rejects.toMatchObject({
        code: 'wrap_unavailable_on_this_device',
      } satisfies Partial<HybridAdapterError>);

    await wrapSvc.zeroize(privateKey, wrapKey, unwrapKey);
  });

  // ------------------------------------------------------------------ deriveUnwrapKey returns correct key properties

  it('deriveUnwrapKey returns non-extractable AES-256-GCM key with unwrapKey usage', async () => {
    const unwrapKey = await unwrapSvc.deriveUnwrapKey(PRF_OUTPUT, CREDENTIAL_ID);

    expect(unwrapKey.algorithm.name).toBe('AES-GCM');
    expect((unwrapKey.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(unwrapKey.extractable).toBe(false);
    expect(unwrapKey.usages).toContain('unwrapKey');

    await wrapSvc.zeroize(unwrapKey);
  });

  // ------------------------------------------------------------------ MemoryService cache reuse regression
  //
  // HybridKeyEnrollmentService caches WrapService.deriveWrapKey()'s output in MemoryService
  // keyed by credentialId; SignService.sign() later reads that same cache entry (TTL 5 min)
  // and hands it straight to unwrap() as the unwrapKey. A single-usage ['wrapKey'] key made
  // that throw InvalidAccessError ("key.usages does not permit this operation"), which the
  // broad catch-all mislabeled as a GCM tag failure ("wrong device") — same device, same
  // passkey, purely a WebCrypto usages bug. See WrapService.deriveWrapKey.

  it('a key derived by WrapService.deriveWrapKey (cached by enroll) is directly usable by unwrap()', async () => {
    const { privateKey } = await wrapSvc.generateHolderKeyPair();
    const wrapKey = await wrapSvc.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const { wrappedBlob, iv, tag } = await wrapSvc.wrapPrivateKey(privateKey, wrapKey);

    // Simulates SignService.sign()'s cache-hit path: memory.get(credentialId) returns the
    // enrollment-time wrap key as-is, with no fresh deriveUnwrapKey() call in between.
    const holderKey = await unwrapSvc.unwrap(wrappedBlob, iv, tag, wrapKey);

    expect(holderKey.usages).toContain('sign');

    await wrapSvc.zeroize(privateKey, wrapKey, holderKey);
  });

  // ------------------------------------------------------------------ W2: non-OperationError path (2026-07-06)
  //
  // unwrap()'s catch must not mislabel every failure as a GCM tag mismatch — only a genuine
  // OperationError (bad auth tag) should map to wrap_unavailable_on_this_device. Anything
  // else (e.g. a key.usages mismatch, InvalidAccessError) must surface as prepare_sign_failed
  // so a holder isn't sent down the "re-sync your passkey" recovery path for a bug that
  // syncing can never fix.

  it('a non-OperationError cause (e.g. key.usages mismatch) maps to prepare_sign_failed, not wrap_unavailable_on_this_device', async () => {
    const { privateKey } = await wrapSvc.generateHolderKeyPair();
    const wrapKey = await wrapSvc.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);
    const { wrappedBlob, iv, tag } = await wrapSvc.wrapPrivateKey(privateKey, wrapKey);

    // A key deliberately missing the 'unwrapKey' usage — crypto.subtle.unwrapKey rejects
    // with InvalidAccessError before ever touching the ciphertext/tag.
    const baseKey = await crypto.subtle.importKey('raw', PRF_OUTPUT, { name: 'HKDF' }, false, ['deriveKey']);
    const usageMismatchedKey = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(CREDENTIAL_ID), info: new TextEncoder().encode('hybrid-wrap-v1') },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt'], // deliberately NOT 'unwrapKey'
    );

    await expect(unwrapSvc.unwrap(wrappedBlob, iv, tag, usageMismatchedKey))
      .rejects.toMatchObject({ code: 'prepare_sign_failed' } satisfies Partial<HybridAdapterError>);

    await wrapSvc.zeroize(privateKey, wrapKey, usageMismatchedKey);
  });
});
