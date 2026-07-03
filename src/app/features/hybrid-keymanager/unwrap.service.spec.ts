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
});
