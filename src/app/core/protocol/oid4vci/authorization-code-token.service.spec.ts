import { TestBed } from '@angular/core/testing';
import { HttpResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthorizationCodeTokenService } from './authorization-code-token.service';
import { PkceService } from './pkce.service';
import { DpopService } from './dpop.service';
import { WiaService } from './wia.service';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { environment } from 'src/environments/environment';

const ISSUER = 'https://sandbox.eudistack.net/issuer';
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`;
const AUTHZ_ENDPOINT = `${ISSUER}/oauth/authorize`;
const PAR_ENDPOINT = `${ISSUER}/oauth/par`;

const HAIP_METADATA: AuthorisationServerMetadata = {
  issuer: ISSUER,
  tokenEndpoint: TOKEN_ENDPOINT,
  authorizationEndpoint: AUTHZ_ENDPOINT,
  pushedAuthorizationRequestEndpoint: PAR_ENDPOINT,
};

const PLAIN_METADATA: AuthorisationServerMetadata = {
  issuer: ISSUER,
  tokenEndpoint: TOKEN_ENDPOINT,
  authorizationEndpoint: AUTHZ_ENDPOINT,
};

const OFFER: CredentialOffer = {
  credentialIssuer: ISSUER,
  credentialConfigurationsIds: ['EmployeeCredential'],
  grant: {},
};

function setup() {
  const pkceServiceMock: jest.Mocked<Pick<PkceService, 'issueCodeVerifier' | 'issueCodeChallenge'>> = {
    issueCodeVerifier: jest.fn().mockReturnValue('verifier123'),
    issueCodeChallenge: jest.fn().mockResolvedValue('challenge123'),
  };
  const dpopServiceMock: jest.Mocked<Pick<DpopService, 'reset' | 'issueProof'>> = {
    reset: jest.fn(),
    issueProof: jest.fn().mockImplementation((_method: string, uri: string) =>
      Promise.resolve({ jwt: `dpop-jwt-for-${uri}`, publicKeyJwk: {} as JsonWebKey })),
  };
  const wiaServiceMock: jest.Mocked<Pick<WiaService, 'reset' | 'fetchAttestationHeaders'>> = {
    reset: jest.fn(),
    fetchAttestationHeaders: jest.fn().mockImplementation((audience: string) =>
      Promise.resolve({ wia: 'wia-jwt', pop: `pop-jwt-for-${audience}` })),
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      AuthorizationCodeTokenService,
      { provide: PkceService, useValue: pkceServiceMock },
      { provide: DpopService, useValue: dpopServiceMock },
      { provide: WiaService, useValue: wiaServiceMock },
    ],
  });

  return {
    service: TestBed.inject(AuthorizationCodeTokenService),
    httpMock: TestBed.inject(HttpTestingController),
    dpopServiceMock,
    wiaServiceMock,
  };
}

/** Lets pending microtasks (the mocked services' resolved promises) drain before the next HTTP call is asserted. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Simulates the authorize redirect: the SPA gets an opaque response whose `url` carries the final `?code=...` callback. */
function flushAuthorizeRedirect(httpMock: HttpTestingController, code: string): void {
  const authReq = httpMock.expectOne((req) => req.url.startsWith(AUTHZ_ENDPOINT));
  authReq.event(new HttpResponse({
    status: 200,
    url: `${environment.oid4vci_redirect_uri}?code=${code}&state=irrelevant`,
  }));
}

describe('AuthorizationCodeTokenService — haip profile', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('attaches OAuth-Client-Attestation headers to the token exchange, not only to PAR (regression for missing header at /oauth/token)', async () => {
    const { service, httpMock, dpopServiceMock, wiaServiceMock } = setup();

    const tokenPromise = service.getToken(OFFER, HAIP_METADATA, 'haip');

    await flushPromises();
    const parReq = httpMock.expectOne(PAR_ENDPOINT);
    expect(parReq.request.headers.get('OAuth-Client-Attestation')).toBe('wia-jwt');
    expect(parReq.request.headers.get('OAuth-Client-Attestation-PoP')).toBe(`pop-jwt-for-${ISSUER}`);
    parReq.flush({ request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 60 });

    await flushPromises();
    flushAuthorizeRedirect(httpMock, 'auth-code-123');

    await flushPromises();
    const tokenReq = httpMock.expectOne(TOKEN_ENDPOINT);
    expect(tokenReq.request.headers.get('DPoP')).toBe(`dpop-jwt-for-${TOKEN_ENDPOINT}`);
    expect(tokenReq.request.headers.get('OAuth-Client-Attestation')).toBe('wia-jwt');
    expect(tokenReq.request.headers.get('OAuth-Client-Attestation-PoP')).toBe(`pop-jwt-for-${ISSUER}`);
    expect(tokenReq.request.body).toContain('code=auth-code-123');
    tokenReq.flush({ access_token: 'at-123', token_type: 'Bearer', expires_in: 300 });

    const result = await tokenPromise;
    expect(result.access_token).toBe('at-123');

    // One WIA/PoP pair for PAR, a fresh one for the token exchange — never the PAR PoP replayed
    // against the token endpoint (the Issuer's SEC-19 jti-replay cache would reject a reused PoP).
    expect(wiaServiceMock.fetchAttestationHeaders).toHaveBeenCalledTimes(2);
    expect(wiaServiceMock.fetchAttestationHeaders).toHaveBeenNthCalledWith(1, ISSUER);
    expect(wiaServiceMock.fetchAttestationHeaders).toHaveBeenNthCalledWith(2, ISSUER);
    expect(dpopServiceMock.issueProof).toHaveBeenCalledWith('POST', TOKEN_ENDPOINT);
  });

  it('falls back to the token endpoint URL as PoP audience when metadata has no issuer', async () => {
    const { service, httpMock, wiaServiceMock } = setup();
    const metadataWithoutIssuer: AuthorisationServerMetadata = { ...HAIP_METADATA, issuer: undefined };

    const tokenPromise = service.getToken(OFFER, metadataWithoutIssuer, 'haip');

    await flushPromises();
    httpMock.expectOne(PAR_ENDPOINT).flush({ request_uri: 'urn:ietf:params:oauth:request_uri:abc', expires_in: 60 });
    await flushPromises();
    flushAuthorizeRedirect(httpMock, 'auth-code-123');
    await flushPromises();
    httpMock.expectOne(TOKEN_ENDPOINT).flush({ access_token: 'at-123', token_type: 'Bearer', expires_in: 300 });

    await tokenPromise;

    expect(wiaServiceMock.fetchAttestationHeaders).toHaveBeenNthCalledWith(1, PAR_ENDPOINT);
    expect(wiaServiceMock.fetchAttestationHeaders).toHaveBeenNthCalledWith(2, TOKEN_ENDPOINT);
  });

  it('does not attach attestation/DPoP headers to the token exchange for the plain (non-HAIP) profile', async () => {
    const { service, httpMock, dpopServiceMock, wiaServiceMock } = setup();

    const tokenPromise = service.getToken(OFFER, PLAIN_METADATA, 'plain');

    await flushPromises();
    flushAuthorizeRedirect(httpMock, 'auth-code-456');

    await flushPromises();
    const tokenReq = httpMock.expectOne(TOKEN_ENDPOINT);
    expect(tokenReq.request.headers.has('DPoP')).toBe(false);
    expect(tokenReq.request.headers.has('OAuth-Client-Attestation')).toBe(false);
    expect(tokenReq.request.headers.has('OAuth-Client-Attestation-PoP')).toBe(false);
    tokenReq.flush({ access_token: 'at-456', token_type: 'Bearer', expires_in: 300 });

    await tokenPromise;

    expect(wiaServiceMock.fetchAttestationHeaders).not.toHaveBeenCalled();
    expect(dpopServiceMock.issueProof).not.toHaveBeenCalled();
  });
});
