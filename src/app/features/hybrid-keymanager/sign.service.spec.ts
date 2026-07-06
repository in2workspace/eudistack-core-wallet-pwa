/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { HybridAdapterError } from 'src/app/core/models/error/HybridAdapterError';
import { MemoryService } from './memory.service';
import { PrfClientService } from './prf-client.service';
import { PrepareSignResponse, SignApi } from './sign.api';
import { SignService } from './sign.service';
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

const CRED_ID = 'cred-sign-test-001';
const VP_CHALLENGE = 'test-challenge-abc';
const CORRELATION_ID = 'corr-id-001';
const KB_JWT = 'header.payload.signature';

// Valid base64url values for the mock PrepareSignResponse fields.
// The bytes are passed to mocked services so their content does not matter.
const PREPARE_RESPONSE: PrepareSignResponse = {
  prf_salt: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',      // 32 bytes
  wrapped_blob: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', // 48 bytes
  iv: 'AAAAAAAAAAAAAAAA',                                        // 12 bytes
  tag: 'AAAAAAAAAAAAAAAAAAAAAA',                                 // 16 bytes
  kdf_params: 'HKDF-SHA-256',
  signing_input: 'eyJhbGciOiJFUzI1NiJ9.eyJub25jZSI6InRlc3QifQ',
  correlation_id: CORRELATION_ID,
};

/**
 * Orchestration tests for SignService (US-04 hybrid signing handshake).
 *
 * All crypto services are mocked; only crypto.subtle.sign runs real WebCrypto
 * (hence the Node polyfill + real holderKey from beforeAll).
 *
 * Spec: EUDISTACK-536 AC-01, AC-04, AC-05, AC-06, ES-03, ES-05, EC-01;
 * technical-design.md §3.2 T15.
 */
describe('SignService', () => {
  let service: SignService;
  let api: jest.Mocked<Pick<SignApi, 'prepareSign' | 'submitSignedAssertion'>>;
  let memory: jest.Mocked<Pick<MemoryService, 'get' | 'set' | 'delete' | 'clear'>>;
  let prfClient: jest.Mocked<Pick<PrfClientService, 'evaluateForWrap'>>;
  let unwrapSvc: jest.Mocked<Pick<UnwrapService, 'deriveUnwrapKey' | 'unwrap'>>;
  let wrapSvc: jest.Mocked<Pick<WrapService, 'zeroize'>>;

  let holderKey: CryptoKey;
  const fakeUnwrapKey = {} as CryptoKey;

  beforeAll(async () => {
    // Real P-256 private key so crypto.subtle.sign receives a valid CryptoKey.
    const kp = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
    holderKey = kp.privateKey;
  });

  beforeEach(() => {
    api = { prepareSign: jest.fn(), submitSignedAssertion: jest.fn() };
    memory = { get: jest.fn(), set: jest.fn(), delete: jest.fn(), clear: jest.fn() };
    prfClient = { evaluateForWrap: jest.fn() };
    unwrapSvc = { deriveUnwrapKey: jest.fn(), unwrap: jest.fn() };
    wrapSvc = { zeroize: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        SignService,
        { provide: SignApi, useValue: api },
        { provide: MemoryService, useValue: memory },
        { provide: PrfClientService, useValue: prfClient },
        { provide: UnwrapService, useValue: unwrapSvc },
        { provide: WrapService, useValue: wrapSvc },
      ],
    });
    service = TestBed.inject(SignService);
  });

  // ------------------------------------------------------------------ happy path (cache miss / EC-01)

  it('cache miss: PRF IKM buffer is zeroed after derivation (W2/AC-05)', async () => {
    const prfBuf = new Uint8Array(32).fill(0xab); // non-zero so fill(0) is detectable
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockResolvedValue(prfBuf);
    unwrapSvc.deriveUnwrapKey.mockResolvedValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockResolvedValue(holderKey);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    api.submitSignedAssertion.mockResolvedValue({ kb_jwt: KB_JWT });
    wrapSvc.zeroize.mockResolvedValue();

    await service.sign(CRED_ID, VP_CHALLENGE);

    expect(prfBuf.every(b => b === 0)).toBe(true); // W2: raw IKM zeroed after deriveUnwrapKey
  });

  it('cache miss: runs PRF ceremony, derives key, caches unwrapKey, signs and submits', async () => {
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockResolvedValue(new Uint8Array(32));
    unwrapSvc.deriveUnwrapKey.mockResolvedValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockResolvedValue(holderKey);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    api.submitSignedAssertion.mockResolvedValue({ kb_jwt: KB_JWT });
    wrapSvc.zeroize.mockResolvedValue();

    const result = await service.sign(CRED_ID, VP_CHALLENGE);

    expect(result).toBe(KB_JWT);
    expect(prfClient.evaluateForWrap).toHaveBeenCalledTimes(1);
    expect(unwrapSvc.deriveUnwrapKey).toHaveBeenCalledWith(expect.any(Uint8Array), CRED_ID);
    expect(memory.set).toHaveBeenCalledWith(CRED_ID, fakeUnwrapKey);
    expect(api.submitSignedAssertion).toHaveBeenCalledWith(
      expect.objectContaining({ credential_id: CRED_ID, correlation_id: CORRELATION_ID }),
    );
    expect(wrapSvc.zeroize).toHaveBeenCalledWith(holderKey); // AC-05
  });

  // ------------------------------------------------------------------ cache hit (AC-04)

  it('cache hit: skips PRF ceremony and uses cached unwrapKey', async () => {
    memory.get.mockReturnValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockResolvedValue(holderKey);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    api.submitSignedAssertion.mockResolvedValue({ kb_jwt: KB_JWT });
    wrapSvc.zeroize.mockResolvedValue();

    await service.sign(CRED_ID, VP_CHALLENGE);

    expect(prfClient.evaluateForWrap).not.toHaveBeenCalled(); // AC-04
    expect(unwrapSvc.deriveUnwrapKey).not.toHaveBeenCalled();
    expect(memory.set).not.toHaveBeenCalled();
    expect(unwrapSvc.unwrap).toHaveBeenCalledWith(
      expect.any(Uint8Array), expect.any(Uint8Array), expect.any(Uint8Array), fakeUnwrapKey,
    );
  });

  // ------------------------------------------------------------------ private key never cached (AC-05/security)

  it('memory.set is only called once with the unwrapKey — holderKey is never cached', async () => {
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockResolvedValue(new Uint8Array(32));
    unwrapSvc.deriveUnwrapKey.mockResolvedValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockResolvedValue(holderKey);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    api.submitSignedAssertion.mockResolvedValue({ kb_jwt: KB_JWT });
    wrapSvc.zeroize.mockResolvedValue();

    await service.sign(CRED_ID, VP_CHALLENGE);

    expect(memory.set).toHaveBeenCalledTimes(1);
    expect(memory.set).toHaveBeenCalledWith(CRED_ID, fakeUnwrapKey);
    expect(memory.set).not.toHaveBeenCalledWith(expect.anything(), holderKey);
  });

  // ------------------------------------------------------------------ ES-03: unwrap failure → fail-closed

  it('unwrap failure throws HybridAdapterError, evicts stale key, and never calls submit (W3/ES-03)', async () => {
    const unwrapError = new HybridAdapterError('GCM tag invalid', {
      code: 'wrap_unavailable_on_this_device',
    });
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockResolvedValue(new Uint8Array(32));
    unwrapSvc.deriveUnwrapKey.mockResolvedValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockRejectedValue(unwrapError);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    wrapSvc.zeroize.mockResolvedValue();

    await expect(service.sign(CRED_ID, VP_CHALLENGE)).rejects.toThrow(HybridAdapterError);

    expect(api.submitSignedAssertion).not.toHaveBeenCalled(); // ES-03 fail-closed
    expect(memory.delete).toHaveBeenCalledWith(CRED_ID); // W3: stale key evicted on GCM fail
  });

  // ------------------------------------------------------------------ ES-05: PRF ceremony failure → abort

  it('PRF evaluateForWrap failure propagates and does not call submit or memory.set', async () => {
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockRejectedValue(new Error('Passkey assertion cancelled'));
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);

    await expect(service.sign(CRED_ID, VP_CHALLENGE)).rejects.toThrow();

    expect(api.submitSignedAssertion).not.toHaveBeenCalled(); // ES-05
    expect(memory.set).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ AC-05: zeroize even on submit error

  it('zeroize is called even when submitSignedAssertion rejects; valid key not evicted (W3/AC-05)', async () => {
    memory.get.mockReturnValue(undefined);
    prfClient.evaluateForWrap.mockResolvedValue(new Uint8Array(32));
    unwrapSvc.deriveUnwrapKey.mockResolvedValue(fakeUnwrapKey);
    unwrapSvc.unwrap.mockResolvedValue(holderKey);
    api.prepareSign.mockResolvedValue(PREPARE_RESPONSE);
    api.submitSignedAssertion.mockRejectedValue(new Error('Network error'));
    wrapSvc.zeroize.mockResolvedValue();

    await expect(service.sign(CRED_ID, VP_CHALLENGE)).rejects.toThrow('Network error');

    expect(wrapSvc.zeroize).toHaveBeenCalledWith(holderKey); // AC-05: always zeroize
    expect(memory.delete).not.toHaveBeenCalled(); // W3: submit failure keeps valid cached key for retry
  });
});
