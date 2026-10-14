import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SERVER_PATH } from 'src/app/core/constants/api.constants';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';
import { PrepareSignResponse, SignApi, SubmitSignedRequest } from './sign.api';

const SERVER_BASE = 'https://tenant.example.com';

describe('SignApi', () => {
  let api: SignApi;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => SERVER_BASE } },
      ],
    });
    api = TestBed.inject(SignApi);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('prepareSign() POSTs the request to the sign/prepare endpoint and returns the response', async () => {
    const req = { credential_id: 'c1', payload: { nonce: 'n' }, format: 'vc+sd-jwt' };
    const response = { correlation_id: 'corr-1' } as PrepareSignResponse;

    const promise = api.prepareSign(req);
    const call = httpMock.expectOne(`${SERVER_BASE}${SERVER_PATH.PASSKEY_PRF_SIGN_PREPARE}`);
    call.flush(response);

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    await expect(promise).resolves.toEqual(response);
  });

  it('submitSignedAssertion() POSTs the signature to the sign/submit endpoint and returns the kb_jwt', async () => {
    const req: SubmitSignedRequest = { credential_id: 'c1', signature: 'sig', correlation_id: 'corr-1' };

    const promise = api.submitSignedAssertion(req);
    const call = httpMock.expectOne(`${SERVER_BASE}${SERVER_PATH.PASSKEY_PRF_SIGN_SUBMIT}`);
    call.flush({ kb_jwt: 'h.p.s' });

    expect(call.request.method).toBe('POST');
    expect(call.request.body).toEqual(req);
    await expect(promise).resolves.toEqual({ kb_jwt: 'h.p.s' });
  });
});
