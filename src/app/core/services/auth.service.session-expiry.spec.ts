import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { RemoteAuthService, TokenPairResponse } from './auth.service';
import { PasskeyStoreService } from './passkey-store.service';
import { PasskeyPrfService } from './passkey-prf.service';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { TenantService } from './tenant.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { environment } from 'src/environments/environment';

const AUTH_BASE = `${environment.server_url}/api/v1/auth`;
const REFRESH_TOKEN_KEY = 'wallet_refresh_token';
const SHORT_TTL_SECONDS = 90;
const REFRESH_LEAD_SECONDS = 60;
const REFRESH_DELAY_MS = (SHORT_TTL_SECONDS - REFRESH_LEAD_SECONDS) * 1000;

class BroadcastChannelMock {
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  postMessage(_message: unknown): void {}
  close(): void {}
}

function buildAccessToken(): string {
  const payload = btoa(JSON.stringify({ email: 'user@example.com' }));
  return `header.${payload}.signature`;
}

describe('RemoteAuthService — session expiry redirect', () => {
  let service: RemoteAuthService;
  let httpMock: HttpTestingController;
  let routerMock: { navigate: jest.Mock };
  let passkeyStoreMock: { hasPasskey: jest.Mock };
  let toastMock: { showInfoAlertByTranslateLabel: jest.Mock };

  beforeAll(() => {
    (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = BroadcastChannelMock;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    localStorage.clear();

    routerMock = { navigate: jest.fn() };
    passkeyStoreMock = { hasPasskey: jest.fn().mockReturnValue(true) };
    toastMock = { showInfoAlertByTranslateLabel: jest.fn().mockReturnValue(of(undefined)) };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        RemoteAuthService,
        { provide: Router, useValue: routerMock },
        { provide: PasskeyStoreService, useValue: passkeyStoreMock },
        { provide: IssuerMetadataCacheService, useValue: { fetchAndCacheIfMissing: jest.fn().mockResolvedValue(undefined) } },
        { provide: TenantService, useValue: { resolveIssuerBaseUrl: jest.fn().mockResolvedValue('https://issuer.example/issuer') } },
        { provide: ToastServiceHandler, useValue: toastMock },
        { provide: PasskeyPrfService, useValue: { assertLocalPasskey: jest.fn().mockResolvedValue(undefined) } },
      ],
    });

    service = TestBed.inject(RemoteAuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    service.dispose();
    jest.useRealTimers();
    localStorage.clear();
  });

  function loginWithShortLivedToken(): void {
    const response: TokenPairResponse = {
      accessToken: buildAccessToken(),
      refreshToken: 'refresh-1',
      expiresIn: SHORT_TTL_SECONDS,
    };
    service.verifyEmail('user@example.com', '123456').subscribe();
    httpMock.expectOne(`${AUTH_BASE}/verify-email`).flush(response);
    routerMock.navigate.mockClear();
  }

  function dropStoredRefreshToken(): void {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    (service as unknown as { refreshTokenValue: string | null }).refreshTokenValue = null;
  }

  describe('background refresh rejected by the server', () => {
    it('backgroundRefresh_refreshTokenRejectedWith401_redirectsToLogin', () => {
      // Arrange
      loginWithShortLivedToken();

      // Act
      jest.advanceTimersByTime(REFRESH_DELAY_MS);
      httpMock.expectOne(`${AUTH_BASE}/refresh`).flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });

      // Assert
      expect(toastMock.showInfoAlertByTranslateLabel).toHaveBeenCalledWith('errors.session-expired');
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('backgroundRefresh_serverError500_redirectsToLogin', () => {
      // Arrange
      loginWithShortLivedToken();

      // Act
      jest.advanceTimersByTime(REFRESH_DELAY_MS);
      httpMock.expectOne(`${AUTH_BASE}/refresh`).flush('Error', { status: 500, statusText: 'Server Error' });

      // Assert
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('background refresh without a stored refresh token', () => {
    it('backgroundRefresh_refreshTokenMissingWithPasskey_showsNoticeAndRedirectsToLogin', () => {
      // Arrange
      loginWithShortLivedToken();
      dropStoredRefreshToken();

      // Act
      jest.advanceTimersByTime(REFRESH_DELAY_MS);

      // Assert
      httpMock.expectNone(`${AUTH_BASE}/refresh`);
      expect(toastMock.showInfoAlertByTranslateLabel).toHaveBeenCalledWith('errors.session-expired');
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
      expect(service.isLoggedIn()).toBe(false);
    });

    it('backgroundRefresh_refreshTokenMissingWithoutPasskey_redirectsToRegister', () => {
      // Arrange
      passkeyStoreMock.hasPasskey.mockReturnValue(false);
      loginWithShortLivedToken();
      dropStoredRefreshToken();

      // Act
      jest.advanceTimersByTime(REFRESH_DELAY_MS);

      // Assert
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/register']);
      expect(service.isLoggedIn()).toBe(false);
    });

    it('backgroundRefresh_refreshTokenMissing_redirectsExactlyOnce', () => {
      // Arrange
      loginWithShortLivedToken();
      dropStoredRefreshToken();

      // Act
      jest.advanceTimersByTime(REFRESH_DELAY_MS);

      // Assert
      expect(routerMock.navigate).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshAccessToken without a stored refresh token', () => {
    it('refreshAccessToken_noActiveSession_failsWithoutRedirecting', () => {
      // Arrange
      const errors: Error[] = [];

      // Act
      service.refreshAccessToken().subscribe({ error: (err: Error) => errors.push(err) });

      // Assert
      expect(errors.map(err => err.message)).toEqual(['No refresh token']);
      expect(routerMock.navigate).not.toHaveBeenCalled();
    });

    it('refreshAccessToken_serviceDisposed_failsWithoutRedirecting', () => {
      // Arrange
      loginWithShortLivedToken();
      dropStoredRefreshToken();
      service.dispose();
      const errors: Error[] = [];

      // Act
      service.refreshAccessToken().subscribe({ error: (err: Error) => errors.push(err) });

      // Assert
      expect(errors.map(err => err.message)).toEqual(['No refresh token']);
      expect(routerMock.navigate).not.toHaveBeenCalled();
    });
  });
});
