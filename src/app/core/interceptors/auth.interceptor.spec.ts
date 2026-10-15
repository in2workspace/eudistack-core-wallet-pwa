/**
 * authInterceptor (EUDISTACK-502 bootstrap timing, EUD-8 credential routing).
 *
 * Which credential each request of the Wallet Unit Service carries
 * (EUD-8 `annex/openapi.yaml`):
 *  - email verification: none;
 *  - passkey registration and sign-in: the registration ticket, if any, plus the cookie;
 *  - renewal: the cookie and `X-Wallet-Request`, no token;
 *  - ending sessions: the session token, the cookie and `X-Wallet-Request`;
 *  - device management and the rest of the API: the session token, renewed once on a 401.
 */

import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { Observable, of, Subject, throwError } from 'rxjs';

import { AccessTokenResponse, AuthService, ForceLogoutOptions } from '../services/auth.service';
import { SessionExpiryMarkerService } from '../services/session-expiry-marker.service';
import { RegistrationTicketService } from '../services/registration-ticket.service';
import { authInterceptor, WALLET_REQUEST_HEADER } from './auth.interceptor';
import { environment } from 'src/environments/environment';

const OWN_BACKEND = environment.server_url || 'http://localhost:8083';
const AUTH = `${OWN_BACKEND}/api/v1/auth`;
const UNAUTHORIZED = { status: 401, statusText: 'Unauthorized' };

class MockAuthService extends AuthService {
  token = '';
  loggedIn = true;
  refresh: () => Observable<AccessTokenResponse> = () => throwError(() => new HttpErrorResponse({ status: 401 }));
  ready: () => Observable<void> = () => of(undefined);
  readonly forceLogoutCalls: (ForceLogoutOptions | undefined)[] = [];
  activity = 0;
  getToken() { return this.token; }
  isLoggedIn$() { return of(this.loggedIn); }
  isInitialized$() { return of(true); }
  isLoggedIn() { return this.loggedIn; }
  getName$() { return of(''); }
  logout() { return of(undefined); }
  forceLogout(options?: ForceLogoutOptions) { this.forceLogoutCalls.push(options); }
  refreshAccessToken(): Observable<AccessTokenResponse> { return this.refresh(); }
  override recordActivity() { this.activity++; }
  override whenAccessTokenReady() { return this.ready(); }
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let auth: MockAuthService;
  let ticket: RegistrationTicketService;
  let marker: SessionExpiryMarkerService;

  beforeEach(() => {
    auth = new MockAuthService();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: auth },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    ticket = TestBed.inject(RegistrationTicketService);
    marker = TestBed.inject(SessionExpiryMarkerService);
  });

  afterEach(() => httpMock.verify());

  describe('bootstrap and external requests', () => {
    it('passes the wallet discovery endpoint through untouched', () => {
      const url = `${OWN_BACKEND}/business-wallet/.well-known/wallet-config-metadata`;
      auth.token = 'session-token';
      http.get(url).subscribe();

      expect(httpMock.expectOne(url).request.headers.has('Authorization')).toBe(false);
    });

    it('passes static assets through untouched', () => {
      auth.token = 'session-token';
      http.get('/assets/tenants/sandbox/theme.json').subscribe();

      expect(httpMock.expectOne('/assets/tenants/sandbox/theme.json').request.headers.has('Authorization')).toBe(false);
    });

    it('never sends a token to another origin', () => {
      auth.token = 'session-token';
      http.get('https://issuer.example/.well-known/openid-credential-issuer').subscribe();

      expect(httpMock.expectOne('https://issuer.example/.well-known/openid-credential-issuer')
        .request.headers.has('Authorization')).toBe(false);
    });
  });

  describe('email verification', () => {
    it.each(['register', 'verify-email'])('sends /auth/%s with no credential', path => {
      auth.token = 'session-token';
      ticket.set('rt_1', 300);
      http.post(`${AUTH}/${path}`, {}).subscribe();

      const request = httpMock.expectOne(`${AUTH}/${path}`).request;
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.headers.has(WALLET_REQUEST_HEADER)).toBe(false);
    });
  });

  describe('passkey registration and sign-in', () => {
    it.each(['passkeys/registration/options', 'passkeys/registration', 'sessions/options', 'sessions'])(
      'sends the registration ticket and the cookie to /auth/%s in the email flow',
      path => {
        auth.token = 'session-token';
        ticket.set('rt_1', 300);
        http.post(`${AUTH}/${path}`, {}).subscribe();

        const request = httpMock.expectOne(`${AUTH}/${path}`).request;
        expect(request.headers.get('Authorization')).toBe('Bearer rt_1');
        expect(request.withCredentials).toBe(true);
      }
    );

    it.each(['sessions', 'passkeys/registration'])('adds X-Wallet-Request to POST /auth/%s, which reads the cookie', path => {
      http.post(`${AUTH}/${path}`, {}).subscribe();

      expect(httpMock.expectOne(`${AUTH}/${path}`).request.headers.get(WALLET_REQUEST_HEADER)).toBe('1');
    });

    it.each(['sessions/options', 'passkeys/registration/options'])('does not add it to /auth/%s', path => {
      http.post(`${AUTH}/${path}`, {}).subscribe();

      expect(httpMock.expectOne(`${AUTH}/${path}`).request.headers.has(WALLET_REQUEST_HEADER)).toBe(false);
    });

    it('signs in with no credential but the cookie outside the email flow (system picker)', () => {
      http.post(`${AUTH}/sessions/options`, {}).subscribe();

      const request = httpMock.expectOne(`${AUTH}/sessions/options`).request;
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.withCredentials).toBe(true);
    });

    it('does not renew or end the session on a 401 of a ceremony (unknown passkey, invalid ticket)', () => {
      let failed: HttpErrorResponse | undefined;
      http.post(`${AUTH}/sessions`, {}).subscribe({ error: err => failed = err });
      httpMock.expectOne(`${AUTH}/sessions`).flush({ type: 'unknown_credential' }, UNAUTHORIZED);

      expect(failed?.status).toBe(401);
      expect(auth.forceLogoutCalls).toHaveLength(0);
    });
  });

  describe('cookie endpoints', () => {
    it('renews with the cookie and X-Wallet-Request, never a token', () => {
      auth.token = 'session-token';
      http.post(`${AUTH}/refresh`, null).subscribe();

      const request = httpMock.expectOne(`${AUTH}/refresh`).request;
      expect(request.headers.get(WALLET_REQUEST_HEADER)).toBe('1');
      expect(request.withCredentials).toBe(true);
      expect(request.headers.has('Authorization')).toBe(false);
    });

    it.each(['sessions/current', 'sessions/others'])('ends /auth/%s with the session token, the cookie and X-Wallet-Request', path => {
      auth.token = 'session-token';
      http.delete(`${AUTH}/${path}`).subscribe();

      const request = httpMock.expectOne(`${AUTH}/${path}`).request;
      expect(request.headers.get('Authorization')).toBe('Bearer session-token');
      expect(request.headers.get(WALLET_REQUEST_HEADER)).toBe('1');
      expect(request.withCredentials).toBe(true);
    });

    it('does not retry ending a session on a 401: the caller decides', () => {
      auth.token = 'session-token';
      http.delete(`${AUTH}/sessions/current`).subscribe({ error: () => undefined });
      httpMock.expectOne(`${AUTH}/sessions/current`).flush({ type: 'invalid_session' }, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toHaveLength(0);
    });
  });

  describe('session-authenticated API', () => {
    it.each([`${AUTH}/passkeys`, `${AUTH}/passkeys/p1/revoke-sessions`, `${OWN_BACKEND}/api/v1/credentials`])(
      'sends the session token, not the ticket, to %s',
      url => {
        auth.token = 'session-token';
        ticket.set('rt_1', 300);
        http.get(url).subscribe();

        const request = httpMock.expectOne(url).request;
        expect(request.headers.get('Authorization')).toBe('Bearer session-token');
        expect(request.headers.has(WALLET_REQUEST_HEADER)).toBe(false);
      }
    );

    it('counts an API call as activity (FR-19)', () => {
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe();
      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush([]);

      expect(auth.activity).toBe(1);
    });

    it('does not count the renewal itself as activity', () => {
      http.post(`${AUTH}/refresh`, null).subscribe();
      httpMock.expectOne(`${AUTH}/refresh`).flush({});

      expect(auth.activity).toBe(0);
    });

    it('on a 401 renews once and retries with the new token', () => {
      auth.token = 'old';
      auth.refresh = () => { auth.token = 'new'; return of({ accessToken: 'new', expiresIn: 300 }); };
      let body: unknown;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe(value => body = value);

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);
      const retry = httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`);
      expect(retry.request.headers.get('Authorization')).toBe('Bearer new');
      retry.flush(['vc']);

      expect(body).toEqual(['vc']);
      expect(auth.forceLogoutCalls).toHaveLength(0);
    });

    it('goes to the access screen with the expired notice when the renewal is rejected (FR-18)', () => {
      auth.token = 'old';
      let failed: HttpErrorResponse | undefined;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: err => failed = err });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toEqual([{ sessionExpired: true }]);
      expect(marker.isSessionExpired(failed!)).toBe(true);
    });

    it('ends the session when the renewal answers 401 invalid_session', () => {
      auth.refresh = () => throwError(() => new HttpErrorResponse({ status: 401, error: { type: 'invalid_session', status: 401 } }));
      let failed: HttpErrorResponse | undefined;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: err => failed = err });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toEqual([{ sessionExpired: true }]);
      expect(marker.isSessionExpired(failed!)).toBe(true);
    });

    it.each([
      [0, null],
      [400, { type: 'invalid_request', status: 400 }],
      [403, { type: 'forbidden', status: 403 }],
      [403, { type: 'access_denied', status: 403 }],
      [404, null],
      [429, { type: 'rate_limited', status: 429 }],
      [500, null],
      [503, null],
    ])('keeps the session when the renewal fails with %s (not an ended session)', (status, error) => {
      auth.token = 'old';
      auth.refresh = () => throwError(() => new HttpErrorResponse({ status, error }));
      let failed: HttpErrorResponse | undefined;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: err => failed = err });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toHaveLength(0);
      expect(failed?.status).toBe(401);
      expect(marker.isSessionExpired(failed!)).toBe(false);
    });

    it('waits for the renewal of an expired token before sending, instead of sending without a token', () => {
      const renewal = new Subject<void>();
      auth.ready = () => renewal.asObservable();
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe();

      httpMock.expectNone(`${OWN_BACKEND}/api/v1/credentials`);
      auth.token = 'renewed';
      renewal.next();
      renewal.complete();

      expect(httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).request.headers.get('Authorization')).toBe('Bearer renewed');
    });

    it('ends the session when the retried call is rejected again', () => {
      auth.refresh = () => of({ accessToken: 'new', expiresIn: 300 });
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: () => undefined });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);
      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toEqual([{ sessionExpired: true }]);
    });

    it('does not end the session when the retried call fails for another reason', () => {
      auth.refresh = () => of({ accessToken: 'new', expiresIn: 300 });
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: () => undefined });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);
      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, { status: 500, statusText: 'Server Error' });

      expect(auth.forceLogoutCalls).toHaveLength(0);
    });

    it('does not force a logout when the user is already signed out', () => {
      auth.loggedIn = false;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: () => undefined });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, UNAUTHORIZED);

      expect(auth.forceLogoutCalls).toHaveLength(0);
    });

    it('passes other errors through without renewing', () => {
      const refresh = jest.fn(() => of({ accessToken: 'new', expiresIn: 300 }));
      auth.refresh = refresh;
      http.get(`${OWN_BACKEND}/api/v1/credentials`).subscribe({ error: () => undefined });

      httpMock.expectOne(`${OWN_BACKEND}/api/v1/credentials`).flush(null, { status: 403, statusText: 'Forbidden' });

      expect(refresh).not.toHaveBeenCalled();
    });
  });
});
