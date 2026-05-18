import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService, AUTH_SERVICE_PROVIDER, RemoteAuthService, TokenPairResponse } from './auth.service';
import { PasskeyStoreService } from './passkey-store.service';
import { PasskeyPrfService } from './passkey-prf.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from '../gateways/wallet-discovery.gateway';
import { LocalAuthService } from './local-auth.service';
import { environment } from 'src/environments/environment';

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

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RemoteAuthService,
        { provide: Router, useValue: routerMock },
        { provide: PasskeyStoreService, useValue: passkeyStoreMock },
      ],
    });

    service = TestBed.inject(RemoteAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
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
