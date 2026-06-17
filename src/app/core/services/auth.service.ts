import { inject, Injectable, OnDestroy, Provider } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { LocalAuthService } from './local-auth.service';
import { PasskeyStoreService } from './passkey-store.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { UrlResolverService } from './url-resolver.service';

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Abstract auth service interface consumed by guards, interceptors, and components.
 * Concrete implementations: RemoteAuthService (server mode) and LocalAuthService (browser/PRF mode).
 */
export abstract class AuthService {
  abstract isLoggedIn$(): Observable<boolean>;
  abstract isInitialized$(): Observable<boolean>;
  abstract isLoggedIn(): boolean;
  abstract getName$(): Observable<string>;
  abstract getToken(): string;
  abstract logout(): Observable<void>;
  abstract forceLogout(): void;
  dispose(): void {}
}

/**
 * DI provider that selects the right AuthService implementation based on the
 * wallet mode resolved at bootstrap by `WalletDiscoveryService` (AC-009.2b,
 * AC-009.3b, AC-009.5d — EUDISTACK-502).
 *
 * The factory runs after `APP_INITIALIZER` completes, so `mode()` is always
 * synchronous and deterministic for the session (AD-3).
 */
export const AUTH_SERVICE_PROVIDER: Provider = {
  provide: AuthService,
  useFactory: () => {
    if (inject(WalletDiscoveryService).mode() === 'server') {
      return inject(RemoteAuthService);
    }
    return inject(LocalAuthService);
  },
};


/**
 * Auth service for server/enterprise mode.
 *
 * Handles email registration (OTP), JWT token management, and refresh.
 * Passkey creation and biometric authentication are always local
 * (handled by PasskeyPrfService) — WebAuthn never goes to the server.
 */
@Injectable({ providedIn: 'root' })
export class RemoteAuthService extends AuthService implements OnDestroy {
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private readonly name$ = new BehaviorSubject<string>('');
  private readonly authenticated$ = new BehaviorSubject<boolean>(false);
  private readonly initialized$ = new BehaviorSubject<boolean>(false);
  private readonly broadcastChannel = new BroadcastChannel('auth');
  private static readonly BROADCAST_FORCE_LOGOUT = 'forceWalletLogout';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly urlResolver = inject(UrlResolverService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  constructor() {
    super();
    // TODO Refactor
    Promise.resolve().then(() => this.loadStoredTokens());
    this.listenToCrossTabLogout();
  }

  // --- Registration flow (email + OTP → JWT tokens) ---

  register(email: string, mode: 'register' | 'login' = 'register'): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.authBase}/register`, { email, mode });
  }

  verifyEmail(email: string, code: string): Observable<TokenPairResponse> {
    return this.http.post<TokenPairResponse>(`${this.authBase}/verify-email`, { email, code }).pipe(
      tap(response => this.handleTokenResponse(response))
    );
  }

  // --- Token management ---

  refreshAccessToken(): Observable<TokenPairResponse> {
    if (!this.refreshTokenValue) {
      return throwError(() => new Error('No refresh token'));
    }
    return this.http.post<TokenPairResponse>(`${this.authBase}/refresh`, {
      refreshToken: this.refreshTokenValue
    }).pipe(
      tap(response => this.handleTokenResponse(response)),
      catchError(err => {
        if (!this.disposed) {
          this.forceLogout();
        }
        return throwError(() => err);
      })
    );
  }

  logout(): Observable<void> {
    this.broadcastChannel.postMessage('softWalletLogout');
    this.softClearState();
    return of(undefined);
  }

  forceLogout(): void {
    this.clearState();
    const hasPasskey = this.passkeyStore.hasPasskey();
    this.router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
  }

  getToken(): string {
    return this.accessToken ?? '';
  }

  getName$(): Observable<string> {
    return this.name$.asObservable();
  }

  isLoggedIn$(): Observable<boolean> {
    return this.authenticated$.asObservable();
  }

  isInitialized$(): Observable<boolean> {
    return this.initialized$.asObservable();
  }

  isLoggedIn(): boolean {
    return this.authenticated$.getValue();
  }

  // --- Private helpers ---

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.broadcastChannel.close();
  }

  private handleTokenResponse(response: TokenPairResponse): void {
    if (this.disposed) return;
    this.accessToken = response.accessToken;
    this.refreshTokenValue = response.refreshToken;
    localStorage.setItem('wallet_refresh_token', response.refreshToken);

    try {
      const payload = JSON.parse(atob(response.accessToken.split('.')[1]));
      this.name$.next(payload.email || payload.name || '');
    } catch {
      this.name$.next('');
    }

    this.authenticated$.next(true);
    this.scheduleTokenRefresh(response.expiresIn);
  }

  private scheduleTokenRefresh(expiresInSeconds: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const refreshInMs = Math.max((expiresInSeconds - 60) * 1000, 0);
    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken().subscribe({
        error: () => { if (!this.disposed) { this.forceLogout(); } }
      });
    }, refreshInMs);
  }

  private loadStoredTokens(): void {
    const storedRefreshToken = localStorage.getItem('wallet_refresh_token');
    if (storedRefreshToken) {
      // Keep the refresh token in memory so verifyPasskey() can exchange it after biometric auth.
      // Do NOT auto-authenticate — the user must present their passkey first.
      this.refreshTokenValue = storedRefreshToken;
    }
    this.initialized$.next(true);
  }

  private listenToCrossTabLogout(): void {
    this.broadcastChannel.onmessage = (event) => {
      if (this.disposed) return;
      if (event.data === RemoteAuthService.BROADCAST_FORCE_LOGOUT) {
        console.warn('Detected force-logout from another tab');
        this.clearState();
        const hasPasskey = this.passkeyStore.hasPasskey();
        this.router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      } else if (event.data === 'softWalletLogout') {
        this.softClearState();
        this.router.navigate(['/auth/login']);
      }
    };
  }

  private softClearState(): void {
    this.accessToken = null;
    this.name$.next('');
    this.authenticated$.next(false);
    // refreshTokenValue and localStorage entry are intentionally kept so the
    // user only needs their passkey to resume the session.
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private clearState(): void {
    this.accessToken = null;
    this.refreshTokenValue = null;
    this.name$.next('');
    this.authenticated$.next(false);
    localStorage.removeItem('wallet_refresh_token');
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.dispose();
  }
}
