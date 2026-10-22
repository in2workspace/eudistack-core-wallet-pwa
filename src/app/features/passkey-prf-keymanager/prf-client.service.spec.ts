import { TestBed } from '@angular/core/testing';
import { PrfClientService } from './prf-client.service';
import { SessionPasskeyService } from 'src/app/core/services/session-passkey.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';
import { AppError } from 'src/app/core/models/error/AppError';

describe('PrfClientService', () => {
  let service: PrfClientService;
  let mockResolveCredentialId: jest.Mock;
  let mockCredentialsGet: jest.Mock;

  const CREDENTIAL_ID_B64 = 'dGVzdC1jcmVkZW50aWFsLWlk'; // base64url of "test-credential-id"
  const PRF_OUTPUT = new Uint8Array(32).fill(0xab);
  const PRF_SALT = new Uint8Array(32).fill(0x01);

  beforeEach(() => {
    mockResolveCredentialId = jest.fn().mockResolvedValue(CREDENTIAL_ID_B64);
    mockCredentialsGet = jest.fn();

    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {},
        getRandomValues: (buf: Uint8Array) => { buf.fill(0x42); return buf; },
      },
      configurable: true,
      writable: true,
    });

    Object.defineProperty(globalThis.navigator, 'credentials', {
      value: { get: mockCredentialsGet },
      configurable: true,
      writable: true,
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SessionPasskeyService,
          useValue: { resolveCredentialId: mockResolveCredentialId },
        },
      ],
    });

    service = TestBed.inject(PrfClientService);
  });

  // ------------------------------------------------------------------ AC-01: prf_salt propagated

  it('passes prfSalt as prf.eval.first to navigator.credentials.get', async () => {
    const assertionResult = buildAssertion(PRF_OUTPUT);
    mockCredentialsGet.mockResolvedValue(assertionResult);

    await service.evaluateForWrap(PRF_SALT);

    const callArgs = mockCredentialsGet.mock.calls[0][0] as CredentialRequestOptions;
    const extensions = callArgs.publicKey!.extensions as { prf?: { eval?: { first?: BufferSource } } };
    expect(extensions.prf?.eval?.first).toBe(PRF_SALT);
  });

  it('returns raw PRF output as Uint8Array', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(PRF_OUTPUT));

    const result = await service.evaluateForWrap(PRF_SALT);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(PRF_OUTPUT);
  });

  // ------------------------------------------------------------------ ES-04: abort when PRF absent

  it('throws AppError when the session passkey cannot be resolved', async () => {
    mockResolveCredentialId.mockRejectedValue(new PasskeyError('passkey_not_found', 'get'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toBeInstanceOf(AppError);
    expect(mockCredentialsGet).not.toHaveBeenCalled();
  });

  it('throws AppError when navigator.credentials.get returns null', async () => {
    mockCredentialsGet.mockResolvedValue(null);

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toBeInstanceOf(AppError);
  });

  it('throws AppError when PRF results are absent from assertion', async () => {
    const assertionNoPrf = buildAssertion(null);
    mockCredentialsGet.mockResolvedValue(assertionNoPrf);

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toBeInstanceOf(AppError);
  });

  it('wraps DOMException from cancelled assertion in AppError', async () => {
    mockCredentialsGet.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toBeInstanceOf(AppError);
  });

  // ------------------------------------------------------------------ same WebAuthn entry point as login / PRF signing

  it('classifies a cancelled assertion as passkey_cancelled (not a failure)', async () => {
    mockCredentialsGet.mockRejectedValue(new DOMException('cancelled', 'NotAllowedError'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toMatchObject({ code: 'passkey_cancelled' });
  });

  it('classifies SecurityError as passkey_security', async () => {
    mockCredentialsGet.mockRejectedValue(new DOMException('rp id', 'SecurityError'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toMatchObject({ code: 'passkey_security' });
  });

  it('reports a missing session passkey as passkey_not_found', async () => {
    mockResolveCredentialId.mockRejectedValue(new PasskeyError('passkey_not_found', 'get'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toMatchObject({ code: 'passkey_not_found' });
  });

  it('reports absent PRF output as prf_unavailable with a translated message', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(null));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toMatchObject({
      code: 'prf_unavailable',
      translationKey: 'errors.prf-unsupported',
    });
  });

  it('only uses translation keys that exist (no raw passkey-prf.error.* keys)', async () => {
    mockCredentialsGet.mockRejectedValue(new Error('unexpected'));

    await expect(service.evaluateForWrap(PRF_SALT)).rejects.toMatchObject({ translationKey: 'auth.errors.passkey-failed' });
  });

  it('evaluates the PRF with the passkey that opened the session (EUD-8 FR-15)', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(PRF_OUTPUT));

    await service.evaluateForWrap(PRF_SALT);

    expect(mockResolveCredentialId).toHaveBeenCalled();
    expect(mockCredentialsGet.mock.calls[0][0].publicKey.allowCredentials).toHaveLength(1);
  });

  it('decodes the base64url credential id for allowCredentials', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(PRF_OUTPUT));

    await service.evaluateForWrap(PRF_SALT);

    const id = mockCredentialsGet.mock.calls[0][0].publicKey.allowCredentials[0].id as Uint8Array;
    expect(new TextDecoder().decode(id)).toBe('test-credential-id');
  });

  // ------------------------------------------------------------------ helpers

  function buildAssertion(prfOutput: Uint8Array | null): PublicKeyCredential {
    return {
      getClientExtensionResults: () =>
        prfOutput
          ? { prf: { results: { first: prfOutput.buffer } } }
          : { prf: { results: {} } },
      id: CREDENTIAL_ID_B64,
      rawId: new ArrayBuffer(0),
      response: {} as AuthenticatorResponse,
      type: 'public-key',
      authenticatorAttachment: null,
    } as unknown as PublicKeyCredential;
  }
});
