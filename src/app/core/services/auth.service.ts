import { inject, Injectable, OnDestroy, Provider } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { Router } from '@angular/router';
import { LocalAuthService } from './local-auth.service';
import { PasskeyStoreService } from './passkey-store.service';

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
}

/** DI provider that selects the right AuthService based on wallet_mode. */
export const AUTH_SERVICE_PROVIDER: Provider = {
  provide: AuthService,
  useFactory: () => {
    if ((environment as any).wallet_mode === 'server') {
      return inject(RemoteAuthService);
    }
    return inject(LocalAuthService);
  },
};

const AUTH_BASE = `${environment.server_url}/api/v1/auth`;

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

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly passkeyStore = inject(PasskeyStoreService);

  constructor() {
    super();
    this.loadStoredTokens();
    this.listenToCrossTabLogout();
  }

  // --- Registration flow (email + OTP → JWT tokens) ---

  register(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${AUTH_BASE}/register`, { email });
  }

  verifyEmail(email: string, code: string): Observable<TokenPairResponse> {
    return this.http.post<TokenPairResponse>(`${AUTH_BASE}/verify-email`, { email, code }).pipe(
      tap(response => this.handleTokenResponse(response))
    );
  }

  // --- Token management ---

  refreshAccessToken(): Observable<TokenPairResponse> {
    if (!this.refreshTokenValue) {
      return throwError(() => new Error('No refresh token'));
    }
    return this.http.post<TokenPairResponse>(`${AUTH_BASE}/refresh`, {
      refreshToken: this.refreshTokenValue
    }).pipe(
      tap(response => this.handleTokenResponse(response)),
      catchError(err => {
        this.forceLogout();
        return throwError(() => err);
      })
    );
  }

  logout(): Observable<void> {
    if (!this.refreshTokenValue) {
      this.clearState();
      return of(undefined);
    }
    return this.http.post<void>(`${AUTH_BASE}/logout`, {
      refreshToken: this.refreshTokenValue
    }).pipe(
      tap(() => {
        this.broadcastChannel.postMessage(RemoteAuthService.BROADCAST_FORCE_LOGOUT);
        this.clearState();
      }),
      catchError(() => {
        this.clearState();
        return of(undefined);
      })
    );
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

  private handleTokenResponse(response: TokenPairResponse): void {
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
        error: () => this.forceLogout()
      });
    }, refreshInMs);
  }

  private loadStoredTokens(): void {
    const storedRefreshToken = localStorage.getItem('wallet_refresh_token');
    if (storedRefreshToken) {
      this.refreshTokenValue = storedRefreshToken;
      this.refreshAccessToken().subscribe({
        next: () => this.initialized$.next(true),
        error: () => {
          localStorage.removeItem('wallet_refresh_token');
          this.authenticated$.next(false);
          this.initialized$.next(true);
        }
      });
    } else {
      this.initialized$.next(true);
    }
  }

  private listenToCrossTabLogout(): void {
    this.broadcastChannel.onmessage = (event) => {
      if (event.data === RemoteAuthService.BROADCAST_FORCE_LOGOUT) {
        console.warn('Detected logout from another tab');
        this.clearState();
        const hasPasskey = this.passkeyStore.hasPasskey();
        this.router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      }
    };
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
    this.broadcastChannel.close();
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
  }
}
