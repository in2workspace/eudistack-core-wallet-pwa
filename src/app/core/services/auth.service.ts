import { inject, Injectable, OnDestroy } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, defer, firstValueFrom, Observable, of, Subscription, throwError } from 'rxjs';
import { catchError, finalize, map, shareReplay, switchMap, tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { UrlResolverService } from './url-resolver.service';
import { TenantService } from './tenant.service';
import { PasskeyCeremonyService, PasskeySession, SessionResponse } from './passkey-ceremony.service';
import { RegistrationTicketService } from './registration-ticket.service';
import { SessionPasskeyService } from './session-passkey.service';
import { ServerSessionDataService } from './server-session-data.service';
import { UserActivityService } from './user-activity.service';
import { WebAuthnBrowserService } from './webauthn-browser.service';
import { PasskeyApiService } from './passkey-api.service';

export type AuthFailureMode = 'force-logout' | 'clear-only';

export interface ForceLogoutOptions {
  /**
   * Browser mode only. Kept for compatibility: in server mode the refresh token
   * is an HttpOnly cookie the Wallet App can neither keep nor drop.
   */
  keepRefreshToken?: boolean;
  /** Server mode: the session ended on its own, so the access screen says it has expired (FR-18). */
  sessionExpired?: boolean;
}

/** New access token of a session. */
export interface AccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

/** Route of the single access screen in server mode (EUD-8). */
export const ACCESS_ROUTE = '/auth/access';

/** Renewal margin before the access token expires (design §2.4). */
export const RENEW_BEFORE_EXPIRY_MS = 30_000;

/** Web Locks name that serializes renewals across the tabs of this origin. */
export const SESSION_REFRESH_LOCK = 'eudistack-wallet-session-refresh';

const AUTH_CHANNEL = 'auth';
const SESSION_ENDED_MESSAGE = 'walletSessionEnded';
const SESSION_OPENED_MESSAGE = 'walletSessionOpened';

/**
 * Whether a failed renewal means the session itself is over (inactive too long,
 * past its maximum duration, ended or reused → 401 `invalid_session`) as opposed
 * to a transient failure (offline, 5xx, 429) where it may still be alive.
 */
export function isRefreshTokenRejected(err: unknown): boolean {
  return err instanceof HttpErrorResponse && [400, 401, 403].includes(err.status);
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
  abstract forceLogout(options?: ForceLogoutOptions): void;
  abstract refreshAccessToken(options?: { onAuthFailure?: AuthFailureMode }): Observable<AccessTokenResponse>;
  /** Notes activity (user interaction or an API call). Server mode renews the session only while there is some. */
  recordActivity(): void {}
  dispose(): void {}
}

interface WebLocks {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/**
 * Auth service for server/enterprise mode (EUD-8).
 *
 * A session is opened only after the Wallet Unit Service verifies a passkey
 * (registration or sign-in, PasskeyCeremonyService). The access token lives in
 * memory; the refresh token only in the HttpOnly `wallet_refresh` cookie, so
 * nothing stored by this app can open or renew a session (FR-16).
 *
 * - Start-up: `POST /auth/refresh` resumes a session after a reload or a reopen
 *   (FR-19). Guards wait for it through `isInitialized$()`.
 * - Renewal: 30 s before the access token expires, only if there has been
 *   activity since the last renewal. Otherwise the token is left to expire and
 *   the next activity renews it; the service applies the inactivity and
 *   maximum-duration limits (FR-18) and a rejected renewal goes to the access
 *   screen with the session-expired notice.
 * - Renewals are single-flight in the tab and serialized across tabs with a
 *   Web Lock, so the same refresh cookie is never presented twice (the service
 *   ends a session whose rotated cookie is reused).
 */
@Injectable({ providedIn: 'root' })
export class RemoteAuthService extends AuthService implements OnDestroy {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private lastRenewalAt = 0;
  private lastActivityAt = 0;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight$: Observable<AccessTokenResponse> | null = null;
  private resume: Promise<boolean> | null = null;
  private sessionData: Promise<void> = Promise.resolve();
  private sessionExpiredNotice = false;
  private disposed = false;

  private readonly name$ = new BehaviorSubject<string>('');
  private readonly authenticated$ = new BehaviorSubject<boolean>(false);
  private readonly initialized$ = new BehaviorSubject<boolean>(false);
  private readonly broadcastChannel = new BroadcastChannel(AUTH_CHANNEL);
  private readonly activitySubscription: Subscription;

  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly urlResolver = inject(UrlResolverService);
  private readonly tenantService = inject(TenantService);
  private readonly ceremony = inject(PasskeyCeremonyService);
  private readonly registrationTicket = inject(RegistrationTicketService);
  private readonly sessionPasskey = inject(SessionPasskeyService);
  private readonly serverSessionData = inject(ServerSessionDataService);
  private readonly webAuthnBrowser = inject(WebAuthnBrowserService);
  private readonly passkeyApi = inject(PasskeyApiService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  constructor() {
    super();
    this.listenToOtherTabs();
    this.activitySubscription = inject(UserActivityService).activity$.subscribe(() => this.recordActivity());
    // Deferred so the request does not run while this service is still being
    // created: the auth interceptor injects AuthService.
    queueMicrotask(() => void this.resumeSession());
  }

  // --- Email verification (FR-03 to FR-06) ---

  /** Asks for a one-time code. The response is the same whether the email has an account or not. */
  requestEmailCode(email: string): Observable<void> {
    return this.http.post<unknown>(`${this.authBase}/register`, { email }).pipe(map(() => undefined));
  }

  /**
   * Verifies the code and keeps the registration ticket in memory. Opens no
   * session. Resolves whether the account already has passkeys (FR-09).
   */
  verifyEmailCode(email: string, code: string): Observable<{ hasPasskeys: boolean }> {
    return this.http.post<{ registrationTicket: string; expiresIn: number; hasPasskeys: boolean }>(
      `${this.authBase}/verify-email`, { email, code }
    ).pipe(
      tap(response => this.registrationTicket.set(response.registrationTicket, response.expiresIn)),
      map(response => ({ hasPasskeys: response.hasPasskeys }))
    );
  }

  /** Leaves the email flow: the registration ticket is forgotten. */
  leaveEmailFlow(): void {
    this.registrationTicket.clear();
  }

  // --- Sessions opened with a verified passkey (FR-07, FR-12 to FR-15, FR-21) ---

  /** Signs in with a passkey: the system picker, or the ticket account's passkeys in the email flow. */
  async signInWithPasskey(): Promise<void> {
    this.openSession(await this.ceremony.signIn());
  }

  /** Registers a new passkey for the ticket's account and opens a session with it. */
  async registerPasskey(displayName?: string): Promise<void> {
    this.openSession(await this.ceremony.register(displayName));
  }

  /** Ends every other session of the account (FR-11). */
  endOtherSessions(): Observable<void> {
    return this.http.delete<void>(`${this.authBase}/sessions/others`);
  }

  /** Resolves once the attestations of the session that just started are in the local store. */
  sessionDataReady(): Promise<void> {
    return this.sessionData;
  }

  /** True once after the session ended on its own: the access screen shows the notice and clears it. */
  consumeSessionExpiredNotice(): boolean {
    const notice = this.sessionExpiredNotice;
    this.sessionExpiredNotice = false;
    return notice;
  }

  /**
   * Resumes the session of the refresh cookie, if any (start-up). Memoized:
   * guards and pages wait on the same attempt through `isInitialized$()`.
   */
  resumeSession(): Promise<boolean> {
    this.resume ??= (async () => {
      try {
        await firstValueFrom(this.refreshAccessToken({ onAuthFailure: 'clear-only' }));
        this.sessionData = this.serverSessionData.sessionStarted();
        await this.sessionData;
        return true;
      } catch {
        // No session to resume: the local attestations belong to one that has ended.
        await this.serverSessionData.sessionEnded();
        return false;
      } finally {
        this.initialized$.next(true);
      }
    })();
    return this.resume;
  }

  // --- Token management ---

  refreshAccessToken(options?: { onAuthFailure?: AuthFailureMode }): Observable<AccessTokenResponse> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }
    const onAuthFailure = options?.onAuthFailure ?? 'force-logout';
    const inFlight$: Observable<AccessTokenResponse> = defer(() => this.withRefreshLock(
      () => firstValueFrom(this.http.post<SessionResponse>(`${this.authBase}/refresh`, null))
    )).pipe(
      tap(session => this.applySession(session)),
      catchError(err => {
        if (!this.disposed) {
          this.handleRefreshFailure(err, onAuthFailure);
        }
        return throwError(() => err);
      }),
      // Reset when the request itself settles, not when a caller unsubscribes.
      finalize(() => {
        if (this.refreshInFlight$ === inFlight$) {
          this.refreshInFlight$ = null;
        }
      }),
      // refCount: false — a caller leaving early must not cancel a rotation the
      // service may already have applied, or the new cookie's token would be lost.
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.refreshInFlight$ = inFlight$;
    return inFlight$;
  }

  override recordActivity(): void {
    if (this.disposed || !this.isLoggedIn()) return;
    this.lastActivityAt = Date.now();
    const renewDue = !this.accessToken || this.lastActivityAt >= this.accessTokenExpiresAt - RENEW_BEFORE_EXPIRY_MS;
    if (renewDue) {
      this.renewInBackground();
    }
  }

  /**
   * Ends the session in the service (FR-20), then locally. An access token left
   * to expire is renewed first, since ending the session needs one. Never errors.
   */
  logout(): Observable<void> {
    if (!this.isLoggedIn()) {
      this.endSessionLocally();
      return of(undefined);
    }
    const accessToken$: Observable<unknown> = this.accessToken
      ? of(this.accessToken)
      : this.refreshAccessToken({ onAuthFailure: 'clear-only' });
    return accessToken$.pipe(
      switchMap(() => this.http.delete<void>(`${this.authBase}/sessions/current`)),
      catchError(err => {
        // Already ended, expired or unreachable: the session is closed here regardless.
        console.warn('[RemoteAuthService] Ending the session in the service failed', err);
        return of(undefined);
      }),
      map(() => undefined),
      finalize(() => {
        this.endSessionLocally();
        this.broadcast(SESSION_ENDED_MESSAGE);
      })
    );
  }

  /** The session is no longer valid: forget it here and in the other tabs, and go to the access screen. */
  forceLogout(options?: ForceLogoutOptions): void {
    if (this.disposed) return;
    this.endSessionLocally();
    this.broadcast(SESSION_ENDED_MESSAGE);
    this.sessionExpiredNotice = options?.sessionExpired === true;
    void this.router.navigateByUrl(ACCESS_ROUTE);
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

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimers();
    this.activitySubscription.unsubscribe();
    this.broadcastChannel.close();
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  // --- Private helpers ---

  private openSession(result: PasskeySession): void {
    if (this.disposed) return;
    this.registrationTicket.clear();
    this.applySession(result.session, result.credentialId);
    this.broadcast(SESSION_OPENED_MESSAGE);
    this.sessionData = this.serverSessionData.sessionStarted();
    void this.signalPasskeyState(result);
    void this.preloadIssuerMetadata();
  }

  private applySession(session: SessionResponse, credentialId?: string): void {
    if (this.disposed) return;
    const now = Date.now();
    this.accessToken = session.accessToken;
    this.accessTokenExpiresAt = now + session.expiresIn * 1000;
    this.lastRenewalAt = now;
    this.sessionPasskey.set(session.passkeyId, credentialId ?? null);
    this.name$.next(readEmailClaim(session.accessToken));
    this.authenticated$.next(true);
    this.scheduleRenewal();
  }

  /**
   * A renewal runs at most every token lifetime, and only with activity since
   * the last one. Without activity the token is dropped at expiry; the next
   * activity (or a 401 in the interceptor) renews it if the session is alive.
   */
  private scheduleRenewal(): void {
    this.clearTimers();
    const renewAt = this.accessTokenExpiresAt - RENEW_BEFORE_EXPIRY_MS;
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      if (this.lastActivityAt > this.lastRenewalAt) {
        this.renewInBackground();
        return;
      }
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = null;
        this.accessToken = null;
      }, Math.max(this.accessTokenExpiresAt - Date.now(), 0));
    }, Math.max(renewAt - Date.now(), 0));
  }

  private renewInBackground(): void {
    this.refreshAccessToken({ onAuthFailure: 'force-logout' }).subscribe({
      // A rejected renewal already went to the access screen with the notice;
      // a transient one is retried with the next activity.
      error: () => undefined,
    });
  }

  /**
   * Only a rejected renewal ends the session. A transient failure keeps it: the
   * service may still hold it, and the next activity tries again.
   */
  private handleRefreshFailure(err: unknown, onAuthFailure: AuthFailureMode): void {
    if (!isRefreshTokenRejected(err)) return;
    if (onAuthFailure === 'clear-only') {
      this.endSessionLocally();
    } else {
      this.forceLogout({ sessionExpired: true });
    }
  }

  private async withRefreshLock<T>(renew: () => Promise<T>): Promise<T> {
    const locks = (navigator as Navigator & { locks?: WebLocks }).locks;
    return locks ? locks.request(SESSION_REFRESH_LOCK, renew) : renew();
  }

  private endSessionLocally(): void {
    const wasActive = this.isLoggedIn() || this.accessToken !== null;
    this.clearTimers();
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.lastActivityAt = 0;
    this.name$.next('');
    this.authenticated$.next(false);
    this.registrationTicket.clear();
    this.sessionPasskey.clear();
    if (wasActive) {
      void this.serverSessionData.sessionEnded();
    }
  }

  /** Signal API (FR-17), best effort: which passkeys the account has and its current email. */
  private async signalPasskeyState(result: PasskeySession): Promise<void> {
    if (!result.userId) return;
    try {
      const passkeys = await firstValueFrom(this.passkeyApi.listPasskeys());
      await this.webAuthnBrowser.signalAllAcceptedCredentials(
        result.rpId, result.userId, passkeys.map(passkey => passkey.credentialId)
      );
    } catch (err) {
      console.warn('[RemoteAuthService] Could not list the passkeys to signal them', err);
    }
    const email = this.name$.getValue();
    if (email) {
      await this.webAuthnBrowser.signalCurrentUserDetails(result.rpId, result.userId, email);
    }
  }

  /**
   * The cookie is shared by every tab of the container (FR-21): when another tab
   * ends the session this one ends too; when another tab opens a session, this
   * one drops its token and resumes the new session.
   */
  private listenToOtherTabs(): void {
    this.broadcastChannel.onmessage = (event: MessageEvent) => {
      if (this.disposed || !this.isLoggedIn()) return;
      if (event.data === SESSION_ENDED_MESSAGE) {
        this.endSessionLocally();
        void this.router.navigateByUrl(ACCESS_ROUTE);
      } else if (event.data === SESSION_OPENED_MESSAGE) {
        this.accessToken = null;
        this.sessionPasskey.clear();
        this.refreshAccessToken({ onAuthFailure: 'force-logout' }).subscribe({
          next: () => { this.sessionData = this.serverSessionData.sessionStarted(); },
          error: () => undefined,
        });
      }
    };
  }

  private broadcast(message: string): void {
    if (!this.disposed) {
      this.broadcastChannel.postMessage(message);
    }
  }

  private clearTimers(): void {
    if (this.renewTimer) {
      clearTimeout(this.renewTimer);
      this.renewTimer = null;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  /**
   * Preloads the OID4VCI metadata of the wallet's own issuer. Fire-and-forget:
   * a failure must never break the sign-in.
   */
  private async preloadIssuerMetadata(): Promise<void> {
    if (this.disposed) return;
    try {
      const issuerUrl = await this.tenantService.resolveIssuerBaseUrl();
      if (this.disposed) return;
      await this.issuerMetadataCache.fetchAndCacheIfMissing(issuerUrl);
    } catch (e) {
      console.warn('[RemoteAuthService] Failed to resolve issuer URL for metadata preload', e);
    }
  }
}

/** The `email` claim of the access token, shown in the menu. The service validates the token, not this app. */
function readEmailClaim(accessToken: string): string {
  try {
    const payload = JSON.parse(base64UrlToText(accessToken.split('.')[1])) as { email?: unknown };
    return typeof payload.email === 'string' ? payload.email : '';
  } catch {
    return '';
  }
}

function base64UrlToText(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
}
