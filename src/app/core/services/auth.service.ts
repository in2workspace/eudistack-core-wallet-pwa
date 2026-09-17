import { inject, Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, of, throwError, firstValueFrom } from 'rxjs';
import { catchError, tap, shareReplay } from 'rxjs/operators';
import { Router } from '@angular/router';
import { PasskeyStoreService } from './passkey-store.service';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { UrlResolverService } from './url-resolver.service';
import { TenantService } from './tenant.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { PasskeyPrfService } from './passkey-prf.service';
import { base64UrlDecode } from '../utils/base64url';
import { WEBAUTHN_ASSERTION_HINTS } from '../constants/webauthn.constants';

export type AuthFailureMode = 'force-logout' | 'clear-only';

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
  abstract refreshAccessToken(options?: { onAuthFailure?: AuthFailureMode }): Observable<TokenPairResponse>;
  dispose(): void {}
}

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
  private refreshInFlight$: Observable<TokenPairResponse> | null = null;

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly urlResolver = inject(UrlResolverService);
  private readonly tenantService = inject(TenantService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly prfService = inject(PasskeyPrfService);

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

  refreshAccessToken(options?: { onAuthFailure?: AuthFailureMode }): Observable<TokenPairResponse> {
    if (!this.refreshTokenValue) {
      return throwError(() => new Error('No refresh token'));
    }
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const onAuthFailure = options?.onAuthFailure ?? 'force-logout';
    this.refreshInFlight$ = this.http.post<TokenPairResponse>(`${this.authBase}/refresh`, {
      refreshToken: this.refreshTokenValue
    }).pipe(
      tap(response => this.handleTokenResponse(response)),
      catchError(err => {
        if (!this.disposed) {
          if (onAuthFailure === 'clear-only') {
            this.clearState();
          } else {
            this.forceLogout();
          }
        }
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );
    return this.refreshInFlight$.pipe(
      tap({
        complete: () => { this.refreshInFlight$ = null; },
        error: () => { this.refreshInFlight$ = null; }
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

  async unlockWithPasskey(): Promise<void> {
    await this.assertLocalPasskey();
    if (this.refreshTokenValue && !this.getToken()) {
      try {
        await firstValueFrom(this.refreshAccessToken({ onAuthFailure: 'clear-only' }));
      } catch {
        // WebAuthn succeeded; clear-only already ran. LoginPage decides the next
        // step from getToken() so a cancelled biometric is not confused with an
        // expired refresh token (Dedalo-1052543).
      }
    }
  }

  async ensureAccessToken(): Promise<void> {
    if (this.getToken()) return;
    if (!this.refreshTokenValue) {
      throw new Error('No refresh token');
    }
    await firstValueFrom(this.refreshAccessToken({ onAuthFailure: 'clear-only' }));
  }

  private async assertLocalPasskey(): Promise<void> {
    const credentialId = this.prfService.getCredentialId();
    if (!credentialId) {
      throw new Error('No passkey found');
    }

    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;
    const credentialIdBuffer = base64UrlDecode(credentialId).buffer as ArrayBuffer;
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialIdBuffer,
          type: 'public-key',
        }],
        userVerification: 'required',
        timeout: 60_000,
        // @ts-expect-error — `hints` not yet in this TS lib's PublicKeyCredentialRequestOptions (WebAuthn L3)
        hints: WEBAUTHN_ASSERTION_HINTS,
      },
    });

    if (!assertion) {
      throw new Error('Authentication cancelled');
    }
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

    void this.preloadIssuerMetadata();
  }

  /**
   * Preloads the OID4VCI metadata of the wallet's own issuer. The issuer base
   * URL is resolved dynamically from the tenant configuration so it is correct
   * both on canonical (same-origin `/issuer`) and custom domains (issuer host
   * declared in custom-domain.json). Fire-and-forget: a failure must never
   * break the login flow.
   */
  private async preloadIssuerMetadata(): Promise<void> {
    if (this.disposed) return;

    try {
      const issuerUrl = await this.tenantService.resolveIssuerBaseUrl();
      if (this.disposed) return;
      await this.issuerMetadataCache.fetchAndCacheIfMissing(issuerUrl);
    } catch (e) {
      // Fire-and-forget: never break login flow if preload fails.
      console.warn('[RemoteAuthService] Failed to resolve issuer URL for metadata preload', e);
    }
  }

  private scheduleTokenRefresh(expiresInSeconds: number): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }

    const refreshInMs = Math.max((expiresInSeconds - 60) * 1000, 0);

    this.refreshTimer = setTimeout(() => {
      // refreshAccessToken() already calls forceLogout() from its own catchError
      // before rethrowing — this is the background/silent path (no user action
      // involved), so the only thing left to do here is let the user know why
      // they just got bounced to login (E-02: silent session expiry).
      this.refreshAccessToken().subscribe({
        error: () => {
          if (!this.disposed) {
            this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.session-expired').subscribe();
          }
        }
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
