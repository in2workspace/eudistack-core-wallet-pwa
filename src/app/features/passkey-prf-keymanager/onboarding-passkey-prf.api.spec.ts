import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_PATH } from 'src/app/core/constants/api.constants';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';
import { OnboardingPasskeyPrfApi } from './onboarding-passkey-prf.api';

const SERVER_BASE = 'https://tenant.example.com';

describe('OnboardingPasskeyPrfApi', () => {
  let api: OnboardingPasskeyPrfApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => SERVER_BASE } },
      ],
    });
    api = TestBed.inject(OnboardingPasskeyPrfApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('init() POSTs to the onboarding/init endpoint and returns the response', async () => {
    const req = { credential_id: 'c1', format: 'vc+sd-jwt' };
    const response = { prf_salt: 's', kdf_params: 'k', signing_pubkey_envelope_format: 'jwk' };

    const promise = api.init(req);
    const call = httpMock.expectOne(`${SERVER_BASE}${SERVER_PATH.PASSKEY_PRF_ONBOARDING_INIT}`);
    call.flush(response);

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    await expect(promise).resolves.toEqual(response);
  });

  it('commit() POSTs to the onboarding/commit endpoint and returns the response', async () => {
    const req = {
      credential_id: 'c1', wrapped_blob: 'w', iv: 'i', tag: 't', kdf_algo: 'HKDF', kdf_version: 1, cnf_jwk: '{}',
    };

    const promise = api.commit(req);
    const call = httpMock.expectOne(`${SERVER_BASE}${SERVER_PATH.PASSKEY_PRF_ONBOARDING_COMMIT}`);
    call.flush({ credential_id: 'c1' });

    expect(call.request.body).toEqual(req);
    await expect(promise).resolves.toEqual({ credential_id: 'c1' });
  });

  it('block() POSTs to the onboarding/block endpoint and returns the response', async () => {
    const req = { credential_id: 'c1', correlation_id: 'corr-1' };

    const promise = api.block(req);
    const call = httpMock.expectOne(`${SERVER_BASE}${SERVER_PATH.PASSKEY_PRF_ONBOARDING_BLOCK}`);
    call.flush({ credential_id: 'c1' });

    expect(call.request.body).toEqual(req);
    await expect(promise).resolves.toEqual({ credential_id: 'c1' });
  });
});
