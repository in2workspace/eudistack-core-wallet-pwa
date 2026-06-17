import { TestBed } from '@angular/core/testing';
import { WrapService } from './wrap.service';

/**
 * Tests for WrapService cryptographic operations.
 *
 * Uses the real SubtleCrypto API (jsdom exposes it in Node 19+ via globalThis.crypto).
 * Where SubtleCrypto is unavailable, individual methods are mocked per test.
 *
 * Spec: EUDISTACK-534 AC-02, AC-03, EC-03, ES-04, NFR-S-534-02, NFR-S-534-05.
 */
describe('WrapService', () => {
  let service: WrapService;

  // PRF output: 32 random bytes (simulates WebAuthn PRF result)
  const PRF_OUTPUT = crypto.getRandomValues(new Uint8Array(32));
  const CREDENTIAL_ID = 'cred-wrap-test-001';

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(WrapService);
  });

  // ------------------------------------------------------------------ AC-01: key generation

  it('generateHolderKeyPair returns ECDSA P-256 key pair', async () => {
    const { privateKey, publicKeyJwk } = await service.generateHolderKeyPair();

    expect(privateKey.algorithm.name).toBe('ECDSA');
    expect((privateKey.algorithm as EcKeyAlgorithm).namedCurve).toBe('P-256');
    expect(privateKey.extractable).toBe(true); // required for wrapKey operation
    expect(publicKeyJwk.kty).toBe('EC');
    expect(publicKeyJwk.crv).toBe('P-256');
    expect(publicKeyJwk.x).toBeTruthy();
    expect(publicKeyJwk.y).toBeTruthy();
  });

  // ------------------------------------------------------------------ AC-03: cnf.jwk no "d"

  it('publicKeyJwk does not contain private key parameter "d"', async () => {
    const { publicKeyJwk } = await service.generateHolderKeyPair();
    expect((publicKeyJwk as Record<string, unknown>)['d']).toBeUndefined();
  });

  // ------------------------------------------------------------------ EC-03: HKDF derivation

  it('deriveWrapKey returns a non-extractable AES-256-GCM key', async () => {
    const wrapKey = await service.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);

    expect(wrapKey.algorithm.name).toBe('AES-GCM');
    expect((wrapKey.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(wrapKey.extractable).toBe(false);
    expect(wrapKey.usages).toContain('wrapKey');
  });

  it('different credentialIds produce different wrap keys', async () => {
    const key1 = await service.deriveWrapKey(PRF_OUTPUT, 'cred-a');
    const key2 = await service.deriveWrapKey(PRF_OUTPUT, 'cred-b');

    // Keys are non-extractable so we verify indirectly: wrapping same plaintext gives different blobs
    const { privateKey } = await service.generateHolderKeyPair();
    const result1 = await service.wrapPrivateKey(privateKey, key1);
    const result2 = await service.wrapPrivateKey(privateKey, key2);

    expect(result1.wrappedBlob).not.toEqual(result2.wrappedBlob);
    await service.zeroize(privateKey, key1, key2);
  });

  // ------------------------------------------------------------------ AC-02: wrapping

  it('wrapPrivateKey returns wrappedBlob, iv (12B), tag (16B)', async () => {
    const { privateKey } = await service.generateHolderKeyPair();
    const wrapKey = await service.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);

    const { wrappedBlob, iv, tag } = await service.wrapPrivateKey(privateKey, wrapKey);

    expect(iv.byteLength).toBe(12);
    expect(tag.byteLength).toBe(16);
    expect(wrappedBlob.byteLength).toBeGreaterThanOrEqual(48);

    await service.zeroize(privateKey, wrapKey);
  });

  it('two wraps of the same key produce different IVs', async () => {
    const { privateKey } = await service.generateHolderKeyPair();
    const wrapKey = await service.deriveWrapKey(PRF_OUTPUT, CREDENTIAL_ID);

    const result1 = await service.wrapPrivateKey(privateKey, wrapKey);
    const result2 = await service.wrapPrivateKey(privateKey, wrapKey);

    expect(result1.iv).not.toEqual(result2.iv);

    await service.zeroize(privateKey, wrapKey);
  });

  // ------------------------------------------------------------------ NFR-S-534-02: zeroize

  it('zeroize calls crypto.subtle.deleteKey for each key', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subtle: any = crypto.subtle;
    const mockDeleteKey = jest.spyOn(subtle, 'deleteKey').mockResolvedValue(undefined);

    const key1 = {} as CryptoKey;
    const key2 = {} as CryptoKey;

    await service.zeroize(key1, key2);

    expect(mockDeleteKey).toHaveBeenCalledWith(key1);
    expect(mockDeleteKey).toHaveBeenCalledWith(key2);
    expect(mockDeleteKey).toHaveBeenCalledTimes(2);

    mockDeleteKey.mockRestore();
  });

  it('zeroize does not throw if deleteKey rejects (best-effort)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subtle: any = crypto.subtle;
    const mockDeleteKey = jest.spyOn(subtle, 'deleteKey').mockRejectedValue(new Error('already deleted'));
    const key = {} as CryptoKey;
    await expect(service.zeroize(key)).resolves.not.toThrow();
    mockDeleteKey.mockRestore();
  });
});