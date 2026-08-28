/**
 * Unit tests for authInterceptor (EUDISTACK-502 bootstrap timing fix).
 *
 * Tests covered:
 *  T-auth-1 — well-known endpoint bypasses AuthService: no auth header added
 *  T-auth-2 — own-backend request with token adds Authorization header
 *  T-auth-3 — /api/v1/auth/* passes through without Authorization header
 *  T-auth-4 — /api/v1/auth/passkeys includes Authorization header (exception)
 *  T-auth-5 — external URL passes through without Authorization header
 *  T-auth-6 — /assets/* bypasses AuthService (ThemeService bootstrap timing fix)
 *  T-auth-7 — 401 response on own-backend triggers forceLogout
 *  T-auth-8 — 401 response on own-backend marks the error via SessionExpiryMarkerService
 */

import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { HttpClient, HttpErrorResponse, HttpStatusCode, provideHttpClient, withInterceptors } from '@angular/common/http';

import { AuthService } from '../services/auth.service';
import { SessionExpiryMarkerService } from '../services/session-expiry-marker.service';
import { authInterceptor } from './auth.interceptor';
import { environment } from 'src/environments/environment';

const OWN_BACKEND = environment.server_url || 'http://localhost:8083';

class MockAuthService extends AuthService {
  private _token = '';
  setToken(t: string) { this._token = t; }
  getToken() { return this._token; }
  isLoggedIn$() { return null as any; }
  isInitialized$() { return null as any; }
  isLoggedIn() { return false; }
  getName$() { return null as any; }
  logout() { return null as any; }
  forceLogout() {}
}

describe('authInterceptor', () => {
  let httpClient: HttpClient;
  let httpMock: HttpTestingController;
  let mockAuth: MockAuthService;
  let sessionExpiryMarker: SessionExpiryMarkerService;

  beforeEach(() => {
    mockAuth = new MockAuthService();

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: mockAuth },
      ],
    });

    httpClient = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    sessionExpiryMarker = TestBed.inject(SessionExpiryMarkerService);
  });

  afterEach(() => httpMock.verify());

  it('T-auth-1: well-known endpoint passes through without Authorization header', () => {
    const url = `${OWN_BACKEND}/business-wallet/.well-known/wallet-config-metadata`;

    httpClient.get(url).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ wallet_mode: 'server', natural_persons_only: false, supported_credentials: [], version: 1 });
  });

  it('T-auth-2: own-backend request with token adds Authorization header', () => {
    mockAuth.setToken('test-jwt');
    const url = `${OWN_BACKEND}/api/v1/credentials`;

    httpClient.get(url).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
    req.flush([]);
  });

  it('T-auth-3: /api/v1/auth/* passes through without Authorization header', () => {
    mockAuth.setToken('test-jwt');
    const url = `${OWN_BACKEND}/api/v1/auth/register`;

    httpClient.post(url, {}).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('T-auth-4: /api/v1/auth/passkeys includes Authorization header', () => {
    mockAuth.setToken('test-jwt');
    const url = `${OWN_BACKEND}/api/v1/auth/passkeys`;

    httpClient.get(url).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-jwt');
    req.flush([]);
  });

  it('T-auth-5: external URL passes through without Authorization header', () => {
    mockAuth.setToken('test-jwt');
    const url = 'https://external.example.com/resource';

    httpClient.get(url).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('T-auth-6: /assets/* bypasses auth header (ThemeService bootstrap timing)', () => {
    mockAuth.setToken('test-jwt');
    const url = '/assets/tenants/sandbox/theme.json';

    httpClient.get(url).subscribe();

    const req = httpMock.expectOne(url);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('T-auth-7: 401 response on own-backend triggers forceLogout', () => {
    const forceLogoutSpy = jest.spyOn(mockAuth, 'forceLogout');
    mockAuth.setToken('expired-jwt');
    const url = `${OWN_BACKEND}/api/v1/credentials`;

    httpClient.get(url).subscribe({ error: () => {} });

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Unauthorized' }, { status: HttpStatusCode.Unauthorized, statusText: 'Unauthorized' });

    expect(forceLogoutSpy).toHaveBeenCalledTimes(1);
  });

  it('T-auth-8: 401 response on own-backend marks the error as session-expired', () => {
    mockAuth.setToken('expired-jwt');
    const url = `${OWN_BACKEND}/api/v1/credentials`;
    let capturedError: HttpErrorResponse | undefined;

    httpClient.get(url).subscribe({ error: (e) => { capturedError = e; } });

    const req = httpMock.expectOne(url);
    req.flush({ message: 'Unauthorized' }, { status: HttpStatusCode.Unauthorized, statusText: 'Unauthorized' });

    expect(capturedError).toBeTruthy();
    expect(sessionExpiryMarker.isSessionExpired(capturedError as HttpErrorResponse)).toBe(true);
  });
});
