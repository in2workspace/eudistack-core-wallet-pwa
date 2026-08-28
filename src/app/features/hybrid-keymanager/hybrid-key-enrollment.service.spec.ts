/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { HybridKeyEnrollmentService } from './hybrid-key-enrollment.service';
import { MemoryService } from './memory.service';
import { PrfClientService } from './prf-client.service';
import { OnboardingHybridApi } from './onboarding-hybrid.api';
import { ProofBuilderService } from 'src/app/core/protocol/oid4vci/proof-builder.service';
import { AppError } from 'src/app/core/models/error/AppError';
import { OID4VCIKeyGenContext } from 'src/app/core/spi/key-storage.provider.service';

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
 * Tests for HybridKeyEnrollmentService.
 *
 * WrapService is left real (pure SubtleCrypto, proven safe under Node's webcrypto
 * polyfill in wrap.service.spec.ts) so the proof-signing step signs against a
 * genuine ECDSA key. PRF/network-facing collaborators are mocked.
 *
 * Spec: EUDISTACK-534 (YARD-126) AC-01, AC-02, AC-03, AC-08, ES-04, ES-05.
 */
describe('HybridKeyEnrollmentService', () => {
  let service: HybridKeyEnrollmentService;

  let mockApi: { init: jest.Mock; commit: jest.Mock; block: jest.Mock };
  let mockMemory: { set: jest.Mock };
  let mockPrf: { evaluateForWrap: jest.Mock };

  const CONTEXT: OID4VCIKeyGenContext = {
    credentialId: 'cred-enrollment-test',
    format: 'vc+sd-jwt',
    supportedAlgs: ['ES256'],
    issuerIdentifier: 'https://issuer.example',
    cNonce: 'nonce-1',
  };
  const PRF_SALT_B64 = 'AAEC'; // short valid base64url
  // Fresh instance per test (not a shared const): enroll() now zeroes it in its finally
  // block (F3 security fix, 2026-07-06) — a shared array would leak zeroing across tests.
  let PRF_OUTPUT: Uint8Array;

  beforeEach(() => {
    PRF_OUTPUT = new Uint8Array(32).fill(0x11);
    mockApi = {
      init: jest.fn().mockResolvedValue({
        prf_salt: PRF_SALT_B64,
        kdf_params: '{}',
        signing_pubkey_envelope_format: 'SD-JWT',
      }),
      commit: jest.fn().mockResolvedValue({ credential_id: CONTEXT.credentialId }),
      block: jest.fn().mockResolvedValue({}),
    };
    mockMemory = { set: jest.fn() };
    mockPrf = {
      evaluateForWrap: jest.fn().mockResolvedValue(PRF_OUTPUT),
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: OnboardingHybridApi, useValue: mockApi },
        { provide: MemoryService, useValue: mockMemory },
        { provide: PrfClientService, useValue: mockPrf },
      ],
    });
    service = TestBed.inject(HybridKeyEnrollmentService);
  });

  // ------------------------------------------------------------------ full flow

  it('completes the full enroll flow and returns publicKeyJwk + a signed OID4VCI proof', async () => {
    const proofBuilder = TestBed.inject(ProofBuilderService);
    const buildSpy = jest.spyOn(proofBuilder, 'createHeaderAndPayload');

    const result = await service.enroll(CONTEXT);

    expect(mockApi.init).toHaveBeenCalledWith({
      credential_id: CONTEXT.credentialId,
      format: CONTEXT.format,
    });
    expect(mockPrf.evaluateForWrap).toHaveBeenCalled();
    expect(buildSpy).toHaveBeenCalledWith(CONTEXT.cNonce, CONTEXT.issuerIdentifier, expect.objectContaining({ kty: 'EC' }));
    expect(mockApi.commit).toHaveBeenCalled();
    expect(mockMemory.set).toHaveBeenCalledWith(CONTEXT.credentialId, expect.anything());

    expect(result.publicKeyJwk.kty).toBe('EC');
    expect(result.jwsProof.split('.')).toHaveLength(3);
  });

  // ------------------------------------------------------------------ AC-03: no private key in commit body

  it('commit body does not contain the private key — only public material', async () => {
    await service.enroll(CONTEXT);

    const commitBody = mockApi.commit.mock.calls[0][0];
    expect(commitBody).not.toHaveProperty('private_key');
    expect(commitBody).not.toHaveProperty('prf_output');
    expect(commitBody).toHaveProperty('cnf_jwk');
    expect(commitBody).toHaveProperty('wrapped_blob');
    expect(commitBody).toHaveProperty('iv');
    expect(commitBody).toHaveProperty('tag');
    expect(commitBody).toHaveProperty('kdf_algo', 'HKDF-SHA-256');
    expect(commitBody).toHaveProperty('kdf_version', 1);
  });

  // ------------------------------------------------------------------ ES-05: private key always zeroized

  it('zeroizes the private key even on a successful enroll, but keeps the wrap key alive', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subtle: any = crypto.subtle;
    subtle.deleteKey = jest.fn().mockResolvedValue(undefined);

    await service.enroll(CONTEXT);

    expect(subtle.deleteKey).toHaveBeenCalledTimes(1); // private key only — wrap key lives in MemoryService
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete subtle.deleteKey;
  });

  it('zeroizes both the private key and the wrap key on a mid-flow failure', async () => {
    mockApi.commit.mockRejectedValue(new Error('network error'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subtle: any = crypto.subtle;
    subtle.deleteKey = jest.fn().mockResolvedValue(undefined);

    await expect(service.enroll(CONTEXT)).rejects.toBeInstanceOf(AppError);

    expect(subtle.deleteKey).toHaveBeenCalledTimes(2); // private key + wrap key
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete subtle.deleteKey;
  });

  // ------------------------------------------------------------------ PRF gate (single ceremony — no separate probe)

  it('calls block and surfaces errors.prf-unsupported when the ceremony confirms no PRF support', async () => {
    mockPrf.evaluateForWrap.mockRejectedValue(
      new AppError('PRF extension not supported or returned no output', {
        translationKey: 'hybrid.error.prfUnavailable',
      }),
    );

    await expect(service.enroll(CONTEXT)).rejects.toMatchObject({
      translationKey: 'errors.prf-unsupported',
    });
    expect(mockApi.block).toHaveBeenCalledWith({
      credential_id: CONTEXT.credentialId,
      correlation_id: expect.any(String),
    });
    expect(mockApi.commit).not.toHaveBeenCalled();
  });

  it('does not call block for a cancelled assertion — not confirmed incapability, holder can retry', async () => {
    mockPrf.evaluateForWrap.mockRejectedValue(
      new AppError('Passkey assertion was cancelled', { translationKey: 'hybrid.error.assertionCancelled' }),
    );

    await expect(service.enroll(CONTEXT)).rejects.toMatchObject({
      translationKey: 'hybrid.error.assertionCancelled',
    });
    expect(mockApi.block).not.toHaveBeenCalled();
    expect(mockApi.commit).not.toHaveBeenCalled();
  });

  it('runs exactly one PRF/WebAuthn ceremony per enrollment', async () => {
    await service.enroll(CONTEXT);

    expect(mockPrf.evaluateForWrap).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------ ES-05: raw PRF output zeroized (security fix, 2026-07-06)

  it('zeroizes the raw PRF output (IKM) on a successful enroll', async () => {
    await service.enroll(CONTEXT);

    expect(PRF_OUTPUT.every(b => b === 0)).toBe(true);
  });

  it('zeroizes the raw PRF output (IKM) even on a mid-flow failure', async () => {
    mockApi.commit.mockRejectedValue(new Error('network error'));

    await expect(service.enroll(CONTEXT)).rejects.toBeInstanceOf(AppError);

    expect(PRF_OUTPUT.every(b => b === 0)).toBe(true);
  });
});
