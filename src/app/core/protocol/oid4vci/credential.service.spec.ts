import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { throwError } from 'rxjs';
import { CredentialService } from './credential.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CredentialAlreadyIssuedError } from '../../models/error/Oid4vciError';
import { JWT_VC_JSON } from 'src/app/core/constants/jwt.constants';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';

const ENDPOINT = 'https://sandbox.eudistack.net/issuer/oid4vci/v1/credential';

describe('CredentialService — credential endpoint errors', () => {
  let service: CredentialService;
  let postFromUrlAndObserveResponse: jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    postFromUrlAndObserveResponse = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        CredentialService,
        { provide: HttpClient, useValue: {} },
        { provide: WalletService, useValue: { postFromUrlAndObserveResponse } },
      ],
    });

    service = TestBed.inject(CredentialService);
  });

  afterEach(() => jest.restoreAllMocks());

  function requestCredential(): Promise<unknown> {
    return service.getCredential({
      jwtProof: 'proof.jwt',
      tokenResponse: { access_token: 'access-tok', token_type: 'bearer' } as TokenResponse,
      credentialIssuerMetadata: { credentialEndpoint: ENDPOINT } as CredentialIssuerMetadata,
      format: JWT_VC_JSON,
      credentialConfigurationId: 'LEARCredentialEmployee',
    });
  }

  function failWith(status: number, error: unknown): void {
    postFromUrlAndObserveResponse.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status, statusText: 'x', url: ENDPOINT, error })),
    );
  }

  it.each([410, 409])('turns %s + credential_already_issued into CredentialAlreadyIssuedError', async (status) => {
    failWith(status, { type: 'credential_already_issued', title: 'Credential already issued', status });

    await expect(requestCredential()).rejects.toBeInstanceOf(CredentialAlreadyIssuedError);
  });

  it('shows the "already in your wallet" message instead of "cannot get VC"', async () => {
    failWith(410, { type: 'credential_already_issued' });

    await expect(requestCredential()).rejects.toMatchObject({ translationKey: 'errors.credential-already-issued' });
  });

  it('does not retry an already-issued credential', async () => {
    failWith(410, { type: 'credential_already_issued' });

    await requestCredential().catch(() => undefined);

    expect(postFromUrlAndObserveResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps "cannot get VC" for a 4xx without a known type', async () => {
    failWith(400, { type: 'invalid_credential_request' });

    await expect(requestCredential()).rejects.toMatchObject({ translationKey: 'errors.cannot-get-VC' });
  });
});
