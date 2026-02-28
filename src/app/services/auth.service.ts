import { DestroyRef, inject, Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { Router } from '@angular/router';

export interface TokenPairResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface VerifyEmailResponse {
  userId: string;
  tempToken: string;
}

const AUTH_BASE = `${environment.server_url}/api/v1/auth`;

@Injectable({
  providedIn: 'root'
})
export class AuthService implements OnDestroy {
  private accessToken: string | null = null;
  private refreshTokenValue: string | null = null;
  private tempToken: string | null = null;
  private readonly name$ = new BehaviorSubject<string>('');
  private readonly authenticated$ = new BehaviorSubject<boolean>(false);
  private readonly broadcastChannel = new BroadcastChannel('auth');
  private static readonly BROADCAST_FORCE_LOGOUT = 'forceWalletLogout';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  constructor() {
    this.loadStoredTokens();
    this.listenToCrossTabLogout();
  }

  // --- Registration flow ---

  register(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${AUTH_BASE}/register`, { email });
  }

  verifyEmail(email: string, code: string): Observable<VerifyEmailResponse> {
    return this.http.post<VerifyEmailResponse>(`${AUTH_BASE}/verify-email`, { email, code }).pipe(
      tap(response => {
        this.tempToken = response.tempToken;
      })
    );
  }

  startPasskeyRegistration(): Observable<any> {
    return this.http.post(`${AUTH_BASE}/passkey/register/start`, null, {
      headers: { Authorization: `Bearer ${this.tempToken}` },
      responseType: 'text'
    }).pipe(
      map(json => JSON.parse(json))
    );
  }

  finishPasskeyRegistration(credential: string, options: string): Observable<TokenPairResponse> {
    return this.http.post<TokenPairResponse>(`${AUTH_BASE}/passkey/register/finish`,
      { credential, options },
      { headers: { Authorization: `Bearer ${this.tempToken}` } }
    ).pipe(
      tap(response => {
        this.tempToken = null;
        this.handleTokenResponse(response);
      })
    );
  }

  // --- Login flow ---

  startLogin(): Observable<any> {
    return this.http.post(`${AUTH_BASE}/login/start`, null, {
      responseType: 'text'
    }).pipe(
      map(json => JSON.parse(json))
    );
  }

  finishLogin(credential: string, options: string): Observable<TokenPairResponse> {
    return this.http.post<TokenPairResponse>(`${AUTH_BASE}/login/finish`,
      { credential, options }
    ).pipe(
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
        this.broadcastChannel.postMessage(AuthService.BROADCAST_FORCE_LOGOUT);
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
    const hasPasskey = localStorage.getItem('wallet_has_passkey') === 'true';
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

  isLoggedIn(): boolean {
    return this.authenticated$.getValue();
  }

  // --- Private helpers ---

  private handleTokenResponse(response: TokenPairResponse): void {
    this.accessToken = response.accessToken;
    this.refreshTokenValue = response.refreshToken;
    localStorage.setItem('wallet_refresh_token', response.refreshToken);

    // Parse JWT payload to get user info
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
    // Refresh 60 seconds before expiry
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
      // Try to get a new access token
      this.refreshAccessToken().subscribe({
        error: () => {
          localStorage.removeItem('wallet_refresh_token');
          this.authenticated$.next(false);
        }
      });
    }
  }

  private listenToCrossTabLogout(): void {
    this.broadcastChannel.onmessage = (event) => {
      if (event.data === AuthService.BROADCAST_FORCE_LOGOUT) {
        console.warn('Detected logout from another tab');
        this.clearState();
        const hasPasskey = localStorage.getItem('wallet_has_passkey') === 'true';
        this.router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      }
    };
  }

  private clearState(): void {
    this.accessToken = null;
    this.refreshTokenValue = null;
    this.tempToken = null;
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
