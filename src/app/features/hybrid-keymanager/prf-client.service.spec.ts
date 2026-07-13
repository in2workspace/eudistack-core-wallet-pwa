import { TestBed } from '@angular/core/testing';
import { PrfClientService } from './prf-client.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { AppError } from 'src/app/core/models/error/AppError';

describe('PrfClientService', () => {
  let service: PrfClientService;
  let mockGetCredentialId: jest.Mock;
  let mockCredentialsGet: jest.Mock;

  const CREDENTIAL_ID_B64 = 'dGVzdC1jcmVkZW50aWFsLWlk'; // base64url of "test-credential-id"
  const PRF_OUTPUT = new Uint8Array(32).fill(0xab);
  const PRF_SALT = new Uint8Array(32).fill(0x01);

  beforeEach(() => {
    mockGetCredentialId = jest.fn().mockReturnValue(CREDENTIAL_ID_B64);
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
          provide: PasskeyPrfService,
          useValue: { getCredentialId: mockGetCredentialId },
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

  it('throws AppError when no credential ID is registered', async () => {
    mockGetCredentialId.mockReturnValue(null);

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

  // ------------------------------------------------------------------ US-07: detectedPrf
  it('returns enabled when PRF output exists', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(PRF_OUTPUT));

    const result = await service.detectPrfSupport();

    expect(result).toBe('enabled');
  });

  it('returns disabled when assertion contains no PRF output', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(null));

    const result = await service.detectPrfSupport();

    expect(result).toBe('disabled');
  });

  it('returns inconclusive when WebAuthn ceremony throws DOMException', async () => {
    mockCredentialsGet.mockRejectedValue(
      new DOMException('cancelled', 'NotAllowedError')
    );

    const result = await service.detectPrfSupport();

    expect(result).toBe('inconclusive');
  });

  it('returns inconclusive when WebAuthn ceremony throws DOMException', async () => {
    mockCredentialsGet.mockRejectedValue(
      new DOMException('cancelled', 'NotAllowedError')
    );

    const result = await service.detectPrfSupport();

    expect(result).toBe('inconclusive');
  });

  it('returns inconclusive when no credential id is registered', async () => {
    mockGetCredentialId.mockReturnValue(null);

    const result = await service.detectPrfSupport();

    expect(result).toBe('inconclusive');

    expect(mockCredentialsGet).not.toHaveBeenCalled();
  });

  it('uses the fixed PRF detection probe', async () => {
    mockCredentialsGet.mockResolvedValue(buildAssertion(PRF_OUTPUT));

    await service.detectPrfSupport();

    const callArgs = mockCredentialsGet.mock.calls[0][0] as CredentialRequestOptions;

    const extensions = callArgs.publicKey!.extensions as {
      prf?: {
        eval?: {
          first?: BufferSource;
        };
      };
    };

    expect(extensions.prf?.eval?.first).toEqual(new Uint8Array(32));
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
