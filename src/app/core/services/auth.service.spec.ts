import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AuthService, AUTH_SERVICE_PROVIDER, RemoteAuthService, TokenPairResponse } from './auth.service';
import { PasskeyStoreService } from './passkey-store.service';
import { PasskeyPrfService } from './passkey-prf.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from '../gateways/wallet-discovery.gateway';
import { LocalAuthService } from './local-auth.service';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { TenantService } from './tenant.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { environment } from 'src/environments/environment';

class MockToastServiceHandler {
  showErrorAlert(_message: string) { return of(undefined); }
  showErrorAlertByTranslateLabel(_message: string) { return of(undefined); }
  showSessionExpiryWarning(_onContinue: () => void) {
    return Promise.resolve({ dismiss: () => Promise.resolve(true) } as unknown as HTMLIonAlertElement);
  }
}

/**
 * Minimal stub for IssuerMetadataCacheService. RemoteAuthService schedules a
 * `fetchAndCacheIfMissing` after a successful token exchange (login-time
 * metadata preload). Tests don't exercise that path, so a resolved-promise
 * stub keeps the constructor happy and the test surface focused.
 */
function issuerMetadataCacheStub(): Pick<IssuerMetadataCacheService, 'fetchAndCacheIfMissing'> {
  return { fetchAndCacheIfMissing: jest.fn().mockResolvedValue(undefined) };
}

/**
 * Stub for TenantService. RemoteAuthService resolves the issuer base URL via
 * `resolveIssuerBaseUrl()` before preloading metadata; a fixed resolved value
 * keeps that path from issuing a real HTTP request to custom-domain.json.
 */
function tenantServiceStub(): Pick<TenantService, 'resolveIssuerBaseUrl'> {
  return { resolveIssuerBaseUrl: jest.fn().mockResolvedValue('https://issuer.example/issuer') };
}

const AUTH_BASE = `${environment.server_url}/api/v1/auth`;

class BroadcastChannelMock {
  name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
  constructor(name: string) {
    this.name = name;
  }
  postMessage(_message: any) {}
  close() {}
}

describe('RemoteAuthService', () => {
  let service: RemoteAuthService;
  let httpMock: HttpTestingController;
  let routerMock: jest.Mocked<Router>;
  let passkeyStoreMock: jest.Mocked<Pick<PasskeyStoreService, 'hasPasskey'>>;
  let toastServiceHandlerMock: MockToastServiceHandler;

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = BroadcastChannelMock;
  });

  beforeEach(() => {
    localStorage.clear();

    routerMock = {
      navigate: jest.fn(),
    } as unknown as jest.Mocked<Router>;

    passkeyStoreMock = {
      hasPasskey: jest.fn().mockReturnValue(false),
    };

    toastServiceHandlerMock = new MockToastServiceHandler();

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RemoteAuthService,
        { provide: Router, useValue: routerMock },
        { provide: PasskeyStoreService, useValue: passkeyStoreMock },
        { provide: IssuerMetadataCacheService, useValue: issuerMetadataCacheStub() },
        { provide: TenantService, useValue: tenantServiceStub() },
        { provide: ToastServiceHandler, useValue: toastServiceHandlerMock },
      ],
    });

    service = TestBed.inject(RemoteAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    jest.useRealTimers();
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('register', () => {
    it('should POST to /register', (done) => {
      service.register('test@example.com').subscribe((res) => {
        expect(res.message).toBe('ok');
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/register`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'test@example.com', mode: 'register' });
      req.flush({ message: 'ok' });
    });
  });

  describe('verifyEmail', () => {
    it('should POST to /verify-email and store tokens', (done) => {
      const tokenResponse: TokenPairResponse = {
        accessToken: 'eyJhbGciOiJSUzI1NiJ9.' + btoa(JSON.stringify({ sub: 'uuid-1', email: 'user@test.com' })) + '.sig',
        refreshToken: 'refresh-xyz',
        expiresIn: 900,
      };

      service.verifyEmail('test@example.com', '123456').subscribe(() => {
        expect(service.getToken()).toBe(tokenResponse.accessToken);
        expect(service.isLoggedIn()).toBe(true);
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/verify-email`);
      expect(req.request.body).toEqual({ email: 'test@example.com', code: '123456' });
      req.flush(tokenResponse);
    });
  });

  describe('logout', () => {
    it('clears access token and authenticated state without HTTP call', (done) => {
      const broadcastSpy = jest.spyOn((service as any).broadcastChannel, 'postMessage');
      (service as any).refreshTokenValue = 'refresh-123';
      (service as any).accessToken = 'access-456';
      (service as any).authenticated$.next(true);
      localStorage.setItem('wallet_refresh_token', 'refresh-123');

      service.logout().subscribe(() => {
        expect(service.getToken()).toBe('');
        expect(service.isLoggedIn()).toBe(false);
        expect(broadcastSpy).toHaveBeenCalledWith('softWalletLogout');
        // refreshToken must be preserved so the user only needs their passkey to resume
        expect((service as any).refreshTokenValue).toBe('refresh-123');
        expect(localStorage.getItem('wallet_refresh_token')).toBe('refresh-123');
        done();
      });
      httpMock.expectNone(`${AUTH_BASE}/logout`);
    });

    it('preserves refresh token when logging out with no active access token', (done) => {
      (service as any).refreshTokenValue = 'stored-rt';
      localStorage.setItem('wallet_refresh_token', 'stored-rt');

      service.logout().subscribe(() => {
        expect(service.isLoggedIn()).toBe(false);
        expect((service as any).refreshTokenValue).toBe('stored-rt');
        expect(localStorage.getItem('wallet_refresh_token')).toBe('stored-rt');
        done();
      });
    });
  });

  describe('loadStoredTokens', () => {
    it('keeps refresh token in memory but does not auto-authenticate', () => {
      localStorage.setItem('wallet_refresh_token', 'persisted-rt');

      (service as any).loadStoredTokens();

      httpMock.expectNone(`${AUTH_BASE}/refresh`);
      expect(service.isLoggedIn()).toBe(false);
      expect((service as any).refreshTokenValue).toBe('persisted-rt');
    });
  });

  describe('forceLogout', () => {
    it('should clear state and navigate to register when no passkey', () => {
      (service as any).accessToken = 'some-token';
      (service as any).authenticated$.next(true);
      passkeyStoreMock.hasPasskey.mockReturnValue(false);

      service.forceLogout();

      expect(service.getToken()).toBe('');
      expect(service.isLoggedIn()).toBe(false);
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/register']);
    });

    it('should clear state and navigate to login when has passkey', () => {
      (service as any).accessToken = 'some-token';
      (service as any).authenticated$.next(true);
      passkeyStoreMock.hasPasskey.mockReturnValue(true);

      service.forceLogout();

      expect(service.getToken()).toBe('');
      expect(service.isLoggedIn()).toBe(false);
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('getToken', () => {
    it('should return empty string when not authenticated', () => {
      expect(service.getToken()).toBe('');
    });
  });

  describe('refreshAccessToken', () => {
    it('should POST to /refresh and update tokens on success', (done) => {
      const tokenResponse: TokenPairResponse = {
        accessToken: 'eyJhbGciOiJSUzI1NiJ9.' + btoa(JSON.stringify({ sub: 'uuid-1' })) + '.sig',
        refreshToken: 'new-refresh',
        expiresIn: 900,
      };
      (service as any).refreshTokenValue = 'old-refresh';

      service.refreshAccessToken().subscribe(() => {
        expect(service.getToken()).toBe(tokenResponse.accessToken);
        expect((service as any).refreshTokenValue).toBe('new-refresh');
        expect(localStorage.getItem('wallet_refresh_token')).toBe('new-refresh');
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: 'old-refresh' });
      req.flush(tokenResponse);
    });

    it('should trigger forceLogout and navigation by default on 401 failure', (done) => {
      (service as any).refreshTokenValue = 'stale-rt';
      (service as any).authenticated$.next(true);
      passkeyStoreMock.hasPasskey.mockReturnValue(true);

      service.refreshAccessToken().subscribe({
        error: () => {
          expect(service.getToken()).toBe('');
          expect(service.isLoggedIn()).toBe(false);
          expect(localStorage.getItem('wallet_refresh_token')).toBeNull();
          expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
          done();
        }
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      req.flush({ detail: 'invalid_grant' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('should ONLY clear state without navigation when onAuthFailure is "clear-only"', (done) => {
      (service as any).refreshTokenValue = 'stale-rt';
      (service as any).authenticated$.next(true);
      localStorage.setItem('wallet_refresh_token', 'stale-rt');

      service.refreshAccessToken({ onAuthFailure: 'clear-only' }).subscribe({
        error: () => {
          expect(service.getToken()).toBe('');
          expect(service.isLoggedIn()).toBe(false);
          expect(localStorage.getItem('wallet_refresh_token')).toBeNull();
          expect(routerMock.navigate).not.toHaveBeenCalled();
          done();
        }
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      req.flush({ detail: 'invalid_grant' }, { status: 401, statusText: 'Unauthorized' });
    });

    it('clears refresh timer in clearState and softClearState', () => {
      const timer = setTimeout(() => {}, 60_000);
      (service as any).refreshTimer = timer;

      (service as any).softClearState();
      expect((service as any).refreshTimer).toBeNull();

      const timer2 = setTimeout(() => {}, 60_000);
      (service as any).refreshTimer = timer2;
      (service as any).clearState();
      expect((service as any).refreshTimer).toBeNull();
    });

    it('returns error if refreshAccessToken is called without a token', (done) => {
      (service as any).refreshTokenValue = null;
      service.refreshAccessToken().subscribe({
        error: (err) => {
          expect(err.message).toBe('No refresh token');
          done();
        }
      });
    });

    it('handles cross-tab logout messages via BroadcastChannel (forceLogout)', () => {
      const clearSpy = jest.spyOn(service as any, 'clearState');
      const navigateSpy = jest.spyOn(routerMock, 'navigate');
      passkeyStoreMock.hasPasskey.mockReturnValue(true);

      // Simulate forced logout message
      const channel = (service as any).broadcastChannel;
      channel.onmessage({ data: 'forceWalletLogout' });

      expect(clearSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(['/auth/login']);
    });

    it('handles cross-tab logout messages via BroadcastChannel (forceLogout) when no passkey', () => {
      const clearSpy = jest.spyOn(service as any, 'clearState');
      const navigateSpy = jest.spyOn(routerMock, 'navigate');
      passkeyStoreMock.hasPasskey.mockReturnValue(false);

      const channel = (service as any).broadcastChannel;
      channel.onmessage({ data: 'forceWalletLogout' });

      expect(clearSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(['/auth/register']);
    });

    it('listenToCrossTabLogout: returns if disposed', () => {
      const clearSpy = jest.spyOn(service as any, 'clearState');
      service.dispose();

      const channel = (service as any).broadcastChannel;
      channel.onmessage({ data: 'forceWalletLogout' });

      expect(clearSpy).not.toHaveBeenCalled();
    });

    it('handles cross-tab logout messages via BroadcastChannel (softWalletLogout)', () => {
      const softClearSpy = jest.spyOn(service as any, 'softClearState');
      const navigateSpy = jest.spyOn(routerMock, 'navigate');

      const channel = (service as any).broadcastChannel;
      channel.onmessage({ data: 'softWalletLogout' });

      expect(softClearSpy).toHaveBeenCalled();
      expect(navigateSpy).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('getName$', () => {
    it('should emit empty string initially', (done) => {
      service.getName$().subscribe((name) => {
        expect(name).toBe('');
        done();
      });
    });
  });

  describe('cross-tab logout', () => {
    it('should listen to broadcast channel messages', () => {
      const channel = (service as any).broadcastChannel;
      expect(channel.onmessage).toBeTruthy();
    });
  });

  it('should close broadcast channel on destroy', () => {
    const closeSpy = jest.spyOn((service as any).broadcastChannel, 'close');
    service.ngOnDestroy();
    expect(closeSpy).toHaveBeenCalled();
  });

  describe('dispose', () => {
    it('sets disposed flag, clears refresh timer and closes broadcast channel', () => {
      const closeSpy = jest.spyOn((service as any).broadcastChannel, 'close');
      const timer = setTimeout(() => {}, 60_000);
      (service as any).refreshTimer = timer;

      service.dispose();

      expect((service as any).disposed).toBe(true);
      expect((service as any).refreshTimer).toBeNull();
      expect(closeSpy).toHaveBeenCalled();
    });

    it('is idempotent — calling twice does not throw', () => {
      const closeSpy = jest.spyOn((service as any).broadcastChannel, 'close');

      expect(() => {
        service.dispose();
        service.dispose();
      }).not.toThrow();

      expect(closeSpy).toHaveBeenCalledTimes(1);
    });

    it('after dispose(), refresh failure does not trigger forceLogout or navigation', () => {
      (service as any).refreshTokenValue = 'refresh-abc';
      service.dispose();

      service.refreshAccessToken().subscribe({ error: () => {} });

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(routerMock.navigate).not.toHaveBeenCalled();
    });

    it('ngOnDestroy() delegates to dispose()', () => {
      const disposeSpy = jest.spyOn(service, 'dispose');
      service.ngOnDestroy();
      expect(disposeSpy).toHaveBeenCalled();
    });

    describe('Coverage improvements', () => {
      it('handleTokenResponse: uses name if email is missing in JWT payload', (done) => {
        const payload = { name: 'John Doe' };
        const token = `abc.${btoa(JSON.stringify(payload))}.xyz`;

        (service as any).handleTokenResponse({
          accessToken: token,
          refreshToken: 'ref',
          expiresIn: 3600
        });

        service.getName$().subscribe(name => {
          expect(name).toBe('John Doe');
          done();
        });
      });

      it('handleTokenResponse: uses empty string if both email and name are missing', (done) => {
        const payload = {};
        const token = `abc.${btoa(JSON.stringify(payload))}.xyz`;

        (service as any).handleTokenResponse({
          accessToken: token,
          refreshToken: 'ref',
          expiresIn: 3600
        });

        service.getName$().subscribe(name => {
          expect(name).toBe('');
          done();
        });
      });

      it('handleTokenResponse: handles malformed JWT payload', (done) => {
        const token = `abc.invalid-base64.xyz`;
        (service as any).handleTokenResponse({
          accessToken: token,
          refreshToken: 'ref',
          expiresIn: 3600
        });
        service.getName$().subscribe(name => {
          expect(name).toBe('');
          done();
        });
      });

      it('isLoggedIn$ and isInitialized$ observables', (done) => {
        let count = 0;
        service.isLoggedIn$().subscribe(val => {
          if (count === 0) expect(val).toBe(false);
          if (count === 1) {
            expect(val).toBe(true);
            done();
          }
          count++;
        });
        service.isInitialized$().subscribe(val => expect(val).toBe(true));
        (service as any).authenticated$.next(true);
      });

      it('handleTokenResponse: returns if disposed', () => {
        service.dispose();
        const spy = jest.spyOn(Storage.prototype, 'setItem');
        (service as any).handleTokenResponse({ accessToken: 'a.b.c', refreshToken: 'r', expiresIn: 10 });
        expect(spy).not.toHaveBeenCalled();
        spy.mockRestore();
      });

      it('preloadIssuerMetadata: handles resolution error gracefully', async () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const tenantServiceMock = TestBed.inject(TenantService);
        jest.spyOn(tenantServiceMock, 'resolveIssuerBaseUrl').mockRejectedValue(new Error('Resolution failed'));

        await (service as any).preloadIssuerMetadata();

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to resolve issuer URL'), expect.any(Error));
        consoleSpy.mockRestore();
      });

      it('preloadIssuerMetadata: returns if disposed after async call', async () => {
        const issuerMetadataCacheMock = TestBed.inject(IssuerMetadataCacheService);
        const tenantServiceMock = TestBed.inject(TenantService);
        const cacheSpy = jest.spyOn(issuerMetadataCacheMock, 'fetchAndCacheIfMissing');
        jest.spyOn(tenantServiceMock, 'resolveIssuerBaseUrl').mockImplementation(async () => {
          service.dispose();
          return 'https://issuer.com';
        });

        await (service as any).preloadIssuerMetadata();
        expect(cacheSpy).not.toHaveBeenCalled();
      });

      it('scheduleTokenRefresh: clears existing timer before setting new one', () => {
        const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
        (service as any).refreshTimer = 123;
        (service as any).scheduleTokenRefresh(3600);
        expect(clearSpy).toHaveBeenCalledWith(123);
      });

      it('scheduleTokenRefresh: triggers forceLogout on refresh error if not disposed', (done) => {
        jest.useFakeTimers();
        const forceLogoutSpy = jest.spyOn(service, 'forceLogout').mockImplementation();

        (service as any).refreshTokenValue = 'valid-refresh';
        (service as any).scheduleTokenRefresh(60); // refreshInMs = 0

        jest.runAllTimers();

        const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
        req.flush('Error', { status: 500, statusText: 'Server Error' });

        // Use a small delay to allow the subscribe error block to run
        setTimeout(() => {
          expect(forceLogoutSpy).toHaveBeenCalled();
          jest.useRealTimers();
          done();
        }, 0);
        jest.runAllTimers();
      });
    });
  });

  describe('scheduleTokenRefresh', () => {
    it('E-02: background refresh failure shows the session-expired toast exactly once and does not double-call forceLogout', () => {
      jest.useFakeTimers();
      const toastSpy = jest.spyOn(toastServiceHandlerMock, 'showErrorAlertByTranslateLabel').mockReturnValue(of(undefined) as any);
      const forceLogoutSpy = jest.spyOn(service, 'forceLogout');
      (service as any).refreshTokenValue = 'refresh-abc';

      (service as any).scheduleTokenRefresh(65);
      jest.advanceTimersByTime(5_000);

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      expect(toastSpy).toHaveBeenCalledWith('errors.session-expired');
      // refreshAccessToken()'s own catchError is the single source of forceLogout() —
      // the timer's error callback used to call it a second time on the same failure.
      expect(forceLogoutSpy).toHaveBeenCalledTimes(1);
    });

    it('shows the session-expiry warning 2 minutes before the silent refresh point', () => {
      jest.useFakeTimers();
      const warningSpy = jest.spyOn(toastServiceHandlerMock, 'showSessionExpiryWarning');

      (service as any).scheduleTokenRefresh(180); // warning @ 60s, silent refresh @ 120s

      jest.advanceTimersByTime(59_000);
      expect(warningSpy).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      expect(warningSpy).toHaveBeenCalledTimes(1);
    });

    it('"Continuar" on the warning triggers an immediate refresh and extends the session', () => {
      jest.useFakeTimers();
      (service as any).refreshTokenValue = 'refresh-abc';
      let capturedOnContinue: (() => void) | undefined;
      jest.spyOn(toastServiceHandlerMock, 'showSessionExpiryWarning').mockImplementation((onContinue: unknown) => {
        capturedOnContinue = onContinue as () => void;
        return Promise.resolve({ dismiss: () => Promise.resolve(true) } as unknown as HTMLIonAlertElement);
      });

      (service as any).scheduleTokenRefresh(180);
      jest.advanceTimersByTime(60_000);

      expect(capturedOnContinue).toBeDefined();
      capturedOnContinue!();

      const req = httpMock.expectOne(`${AUTH_BASE}/refresh`);
      const newToken = 'h.' + btoa(JSON.stringify({ email: 'continued@example.com' })) + '.s';
      req.flush({ accessToken: newToken, refreshToken: 'refresh-new', expiresIn: 900 });

      expect(service.getToken()).toBe(newToken);
    });

    it('"Continuar" cancels the still-pending automatic refresh, avoiding a one-time-use refresh-token race', () => {
      // Regression guard: the backend rotates refresh tokens on use (one-time use). Before
      // this fix, clicking "Continuar" left the automatic refreshTimer armed — if both fired
      // close together, whichever lost the race got an "invalid token" error and the user was
      // shown "session expired" right after confirming they wanted to stay logged in.
      jest.useFakeTimers();
      (service as any).refreshTokenValue = 'refresh-abc';
      const expiredToastSpy = jest.spyOn(toastServiceHandlerMock, 'showErrorAlertByTranslateLabel').mockReturnValue(of(undefined) as any);
      let capturedOnContinue: (() => void) | undefined;
      jest.spyOn(toastServiceHandlerMock, 'showSessionExpiryWarning').mockImplementation((onContinue: unknown) => {
        capturedOnContinue = onContinue as () => void;
        return Promise.resolve({ dismiss: () => Promise.resolve(true) } as unknown as HTMLIonAlertElement);
      });

      (service as any).scheduleTokenRefresh(180); // warning @ 60s, automatic silent refresh @ 120s
      jest.advanceTimersByTime(60_000);

      expect(capturedOnContinue).toBeDefined();
      capturedOnContinue!();

      // The manual refresh is now in flight — deliberately left unflushed so the natural
      // reschedule-on-success path (which would also clear the old timer) can't mask the bug:
      // this only proves the fix if refreshTimer was cancelled synchronously at click-time.
      const manualReq = httpMock.expectOne(`${AUTH_BASE}/refresh`);

      // Advance to when the automatic refreshTimer would have fired if it hadn't been
      // cancelled — without the fix, this creates a second, racing /refresh request here.
      jest.advanceTimersByTime(60_000);
      httpMock.expectNone(`${AUTH_BASE}/refresh`);

      const newToken = 'h.' + btoa(JSON.stringify({ email: 'continued@example.com' })) + '.s';
      manualReq.flush({ accessToken: newToken, refreshToken: 'refresh-new', expiresIn: 900 });

      expect(expiredToastSpy).not.toHaveBeenCalledWith('errors.session-expired');
    });

    it('scheduling a new refresh cycle dismisses a still-pending warning from the previous one', async () => {
      jest.useFakeTimers();
      const dismissSpy = jest.fn().mockResolvedValue(true);
      jest.spyOn(toastServiceHandlerMock, 'showSessionExpiryWarning')
        .mockResolvedValue({ dismiss: dismissSpy } as unknown as HTMLIonAlertElement);

      (service as any).scheduleTokenRefresh(180);
      jest.advanceTimersByTime(60_000); // warning fires and is showing
      await Promise.resolve();

      // A fresh cycle starts (e.g. a successful login/refresh elsewhere) before
      // the open warning was ever answered.
      (service as any).scheduleTokenRefresh(900);
      await Promise.resolve();

      expect(dismissSpy).toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// T-14 — AUTH_SERVICE_PROVIDER factory selects implementation by wallet mode
// AC-009.2b, AC-009.3b, AC-009.5d (EUDISTACK-502)
// ---------------------------------------------------------------------------
describe('AUTH_SERVICE_PROVIDER', () => {
  /**
   * Stub LocalAuthService — avoids pulling in PasskeyPrfService and its
   * WebAuthn transitive dependencies, while still satisfying `instanceof`.
   */
  @Injectable()
  class StubLocalAuthService extends LocalAuthService {}

  /**
   * Stub RemoteAuthService — avoids HttpClient + BroadcastChannel setup,
   * while still satisfying `instanceof`.
   */
  @Injectable()
  class StubRemoteAuthService extends RemoteAuthService {}

  function configureWithMode(walletMode: 'browser' | 'server'): void {
    const discoveryMock: Partial<WalletDiscoveryService> = {
      mode: () => walletMode,
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AUTH_SERVICE_PROVIDER,
        { provide: RemoteAuthService, useClass: StubRemoteAuthService },
        { provide: LocalAuthService, useClass: StubLocalAuthService },
        { provide: WalletDiscoveryService, useValue: discoveryMock },
        { provide: WALLET_DISCOVERY_GATEWAY, useValue: { fetch: jest.fn() } },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: PasskeyStoreService, useValue: { hasPasskey: jest.fn().mockReturnValue(false) } },
        { provide: PasskeyPrfService, useValue: {} },
        { provide: IssuerMetadataCacheService, useValue: issuerMetadataCacheStub() },
        { provide: TenantService, useValue: tenantServiceStub() },
        { provide: ToastServiceHandler, useValue: new MockToastServiceHandler() },
      ],
    });
  }

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = class {
      name: string;
      onmessage: ((ev: MessageEvent) => void) | null = null;
      constructor(name: string) { this.name = name; }
      postMessage(_message: unknown) {}
      close() {}
    };
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('factory selects LocalAuthService when discovery mode is browser', () => {
    configureWithMode('browser');

    const authService = TestBed.inject(AuthService);

    expect(authService).toBeInstanceOf(LocalAuthService);
  });

  it('factory selects RemoteAuthService when discovery mode is server', () => {
    configureWithMode('server');

    const authService = TestBed.inject(AuthService);

    expect(authService).toBeInstanceOf(RemoteAuthService);
  });
});
