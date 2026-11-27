import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, defer, firstValueFrom, from, fromEvent, Observable, of, race, Subscription, throwError, timer } from 'rxjs';
import { catchError, filter, finalize, map, shareReplay } from 'rxjs/operators';
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
import { DeviceState, WalletInstanceService } from './wallet-instance.service';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { AUTH_PROBLEM_TYPE, authProblemType } from 'src/app/core/models/error/WalletAuthError';

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

/** Wallet home once signed in. */
const WALLET_HOME = '/tabs/credentials';

/** "Registrar este dispositivo" (EUD-15 design §2.2): its own route, after the passkey, never inside it. */
export const REGISTER_DEVICE_ROUTE = '/registrar-dispositivo';

/** Backoff of the background binding after a temporary failure (EUD-15 design §2.2). */
export const DEVICE_RETRY_BASE_MS = 5_000;
export const DEVICE_RETRY_MAX_MS = 60_000;

/** Renewal margin before the access token expires (design §2.4). */
export const RENEW_BEFORE_EXPIRY_MS = 30_000;

/** An access token this close to expiry is treated as missing when ending the session. */
export const LOGOUT_TOKEN_MARGIN_MS = 10_000;

/** Wait before the second start-up resume attempt after a temporary failure (or until back online). */
export const RESUME_RETRY_DELAY_MS = 3_000;

/** Backoff of background renewals after a temporary failure: 2 s, 4 s, 8 s… up to 60 s. */
export const RENEW_BACKOFF_BASE_MS = 2_000;
export const RENEW_BACKOFF_MAX_MS = 60_000;

/** Web Locks name that serializes renewals across the tabs of this origin. */
export const SESSION_REFRESH_LOCK = 'eudistack-wallet-session-refresh';

/**
 * Set while the user asked to log out but the service has not confirmed it yet
 * (offline, 5xx). Not a credential: it only stops the start-up resume from
 * reviving that session and makes the app finish the logout once back online.
 */
export const SERVER_LOGOUT_PENDING_KEY = 'wallet_server_logout_pending';

/**
 * Set in sessionStorage while this tab or window has a session (FR-19). It
 * survives a reload but not closing the tab or the window, so a reopened Wallet
 * App does not resume the session of the refresh cookie and asks for the
 * passkey again. Not a credential: it only allows the start-up resume.
 */
export const SESSION_IN_TAB_KEY = 'wallet_session_in_tab';

const AUTH_CHANNEL = 'auth';
const SESSION_ENDED_MESSAGE = 'walletSessionEnded';
const SESSION_OPENED_MESSAGE = 'walletSessionOpened';
/** Another tab registered the device of the shared session (EUD-15). */
const DEVICE_REGISTERED_MESSAGE = 'walletDeviceRegistered';

interface SessionEndedMessage {
  type: typeof SESSION_ENDED_MESSAGE;
  expired: boolean;
}

/**
 * Whether a failed renewal means the session itself is over: a 401 with the
 * RFC 9457 `type` `invalid_session` (inactive too long, past its maximum
 * duration, ended or reused). A 401 without a readable problem body counts too,
 * since nothing says the session is alive. Any other failure (400, 403, 404,
 * 429, 5xx, offline) is a failure of that call: the session may still be alive.
 */
export function isRefreshTokenRejected(err: unknown): boolean {
  if (!(err instanceof HttpErrorResponse) || err.status !== 401) return false;
  const type = authProblemType(err);
  return type === null || type === AUTH_PROBLEM_TYPE.INVALID_SESSION;
}

/** A renewal whose result arrived after the session it belonged to had ended or been replaced. */
export class SessionChangedError extends Error {
  public constructor() {
    super('The session changed while it was being renewed');
  }
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
  recordActivity(): void {
    // No-op by default: browser mode has no server session to keep alive. RemoteAuthService overrides it.
  }
  /** Completes once a session that let its access token expire has a fresh one (or cannot get it now). */
  whenAccessTokenReady(): Observable<void> {
    return of(undefined);
  }
  /**
   * After a 403 `instance_required` (EUD-15 design §2.2): binds the session to its device once more. Emits
   * `true` when the call can be retried. Browser mode has no devices.
   */
  recoverDevice(): Observable<boolean> {
    return of(false);
  }
  /**
   * The session could not be bound to its device for a temporary reason (offline, 5xx) and the binding is being
   * retried (EUD-15 design §2.2): the wallet is shown with the attestation actions disabled. Browser mode: never.
   */
  deviceUnavailable(): boolean {
    return false;
  }
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
 * memory; the refresh token only in the HttpOnly refresh cookie, so nothing
 * stored by this app can open or renew a session (FR-16).
 *
 * - Start-up: `POST /auth/refresh` resumes a session after a reload (FR-19),
 *   never in a tab or window opened anew (see SESSION_IN_TAB_KEY), which shows
 *   the access screen. Guards wait for it through `isInitialized$()`. A temporary failure
 *   is retried once (after a short delay or when back online) before showing the
 *   access screen, and again in the background when the connection returns.
 * - Renewal: 30 s before the access token expires, only if there has been
 *   activity since the last renewal, and also when the page is hidden with
 *   activity pending. Otherwise the token is left to expire and the next
 *   activity renews it; the service applies the inactivity and maximum-duration
 *   limits (FR-18) and a rejected renewal goes to the access screen with the
 *   session-expired notice. Temporary failures back off exponentially.
 * - Every session has an epoch: a renewal that settles after its session ended
 *   or was replaced (logout, another tab, a new sign-in) is discarded.
 * - Renewals are single-flight in the tab and serialized across tabs with a
 *   Web Lock, so the same refresh cookie is never presented twice (the service
 *   ends a session whose rotated cookie is reused). Known limit: a browser
 *   without the Web Locks API (all current engines have it) only gets the
 *   in-tab single-flight.
 */
@Injectable({ providedIn: 'root' })
export class RemoteAuthService extends AuthService implements OnDestroy {
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private lastRenewalAt = 0;
  private lastActivityAt = 0;
  private epoch = 0;
  private renewalFailures = 0;
  private renewalBlockedUntil = 0;
  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshInFlight: { epoch: number; renewal$: Observable<AccessTokenResponse> } | null = null;
  private resume: Promise<boolean> | null = null;
  private resumeDeferred = false;
  private logoutInFlight: Promise<void> | null = null;
  private sessionData: Promise<void> = Promise.resolve();
  private sessionExpiredNotice = false;
  private disposed = false;
  /** `sub` of the session's account: the key of its device in IndexedDB (never the email). */
  private accountSub: string | null = null;
  /** Binding of the session to its device, once per session (epoch). */
  private deviceState: { epoch: number; account: string; state: Promise<DeviceState> } | null = null;
  /** One recovery after `instance_required` at a time, shared by the calls that got it. */
  private deviceRecovery: Promise<boolean> | null = null;
  /** The binding failed for a temporary reason and is retried in the background (design §2.2). */
  private readonly _deviceUnavailable = signal(false);
  private deviceRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceRetryAttempt = 0;

  private readonly name$ = new BehaviorSubject<string>('');
  private readonly authenticated$ = new BehaviorSubject<boolean>(false);
  private readonly initialized$ = new BehaviorSubject<boolean>(false);
  private readonly broadcastChannel = new BroadcastChannel(AUTH_CHANNEL);
  private readonly subscriptions = new Subscription();
  private readonly _serverLogoutPending = signal(localStorage.getItem(SERVER_LOGOUT_PENDING_KEY) === '1');

  /** True while a logout the user asked for has not been confirmed by the service yet. */
  readonly serverLogoutPending = this._serverLogoutPending.asReadonly();

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
  private readonly walletInstance = inject(WalletInstanceService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  constructor() {
    super();
    this.listenToOtherTabs();
    this.subscriptions.add(inject(UserActivityService).activity$.subscribe(() => this.recordActivity()));
    this.subscriptions.add(fromEvent(window, 'online').subscribe(() => this.onOnline()));
    this.subscriptions.add(
      fromEvent(document, 'visibilitychange')
        .pipe(filter(() => document.visibilityState === 'hidden'))
        .subscribe(() => this.onPageHidden())
    );
    this.subscriptions.add(fromEvent(window, 'pagehide').subscribe(() => this.onPageHide()));
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
      map(response => {
        this.registrationTicket.set(response.registrationTicket, response.expiresIn);
        return { hasPasskeys: response.hasPasskeys };
      })
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
  async registerPasskey(): Promise<void> {
    this.openSession(await this.ceremony.register());
  }

  /** Finishes a registration whose PRF check needed a fresh user gesture, and opens the session. */
  async completeRegistration(resume: () => Promise<PasskeySession>): Promise<void> {
    this.openSession(await resume());
  }

  /** Ends every other session of the account (FR-11). */
  endOtherSessions(): Observable<void> {
    return this.http.delete<void>(`${this.authBase}/sessions/others`);
  }

  /** Resolves once the attestations of the session that just started are in the local store. */
  sessionDataReady(): Promise<void> {
    return this.sessionData;
  }

  // --- Device of the session (EUD-15) ---

  /** `sub` of the account of the session, or `null` without a session. */
  accountId(): string | null {
    return this.isLoggedIn() ? this.accountSub : null;
  }

  /**
   * Binds the session to the device this Wallet App remembers, once per session, before anything else uses it
   * (EUD-15 FR-05, FR-06): `unregistered` means "Registrar este dispositivo" comes next. A reload of the Wallet
   * App binds the same session to the same device again, with no step for the user.
   */
  deviceReady(): Promise<DeviceState> {
    // A renewal in flight may bring the session of another account (another tab signed in): wait for it.
    if (!this.accessToken && this.refreshInFlight?.epoch === this.epoch) {
      return firstValueFrom(this.refreshInFlight.renewal$)
        .then(() => this.deviceReady(), () => 'unavailable' as DeviceState);
    }
    const account = this.accountId();
    if (!account) {
      // A session whose token carries no `sub` cannot key its device: never send it to the registration, which
      // could not register it either (it would bounce between that screen and the access screen).
      return Promise.resolve(this.isLoggedIn() ? 'unavailable' : 'unregistered');
    }
    // Keyed by session and account: another tab may open a session of another account at any time.
    if (this.deviceState?.epoch !== this.epoch || this.deviceState.account !== account) {
      const epoch = this.epoch;
      const state = this.walletInstance.bindRemembered(account)
        .then(result => this.onDeviceState(result, epoch, account));
      this.deviceState = { epoch, account, state };
    }
    return this.deviceState.state;
  }

  override deviceUnavailable(): boolean {
    return this._deviceUnavailable();
  }

  /**
   * A temporary failure (offline, 5xx) leaves the wallet visible with the attestation actions disabled and binds
   * again in the background, with exponential backoff (design §2.2). Once bound, the attestations load; if the
   * device is gone, "Registrar este dispositivo" comes next.
   */
  private onDeviceState(state: DeviceState, epoch: number, account: string): DeviceState {
    if (epoch !== this.epoch || account !== this.accountSub) {
      return state;
    }
    const wasUnavailable = this._deviceUnavailable();
    this.clearDeviceRetry();
    this._deviceUnavailable.set(state === 'unavailable');
    if (state !== 'unavailable') {
      this.deviceRetryAttempt = 0;
      if (state === 'bound' && wasUnavailable) {
        // Bound at last, by the background retry or by an `instance_required` recovery: the attestations of the
        // session load now, and an offer or request postponed meanwhile is resumed.
        this.sessionData = this.serverSessionData.sessionStarted();
        this.resumePostponedFlow();
      }
      return state;
    }
    const delay = Math.min(DEVICE_RETRY_BASE_MS * 2 ** this.deviceRetryAttempt, DEVICE_RETRY_MAX_MS);
    this.deviceRetryAttempt++;
    this.deviceRetryTimer = setTimeout(() => {
      this.deviceRetryTimer = null;
      if (this.disposed || epoch !== this.epoch || !this.isLoggedIn()) return;
      this.deviceState = null;
      void this.deviceReady().then(retried => {
        // 'bound' is handled by onDeviceState itself.
        if (epoch === this.epoch && retried === 'unregistered') {
          this.goToDeviceRegistration();
        }
      });
    }, delay);
    return state;
  }

  /** An offer or presentation request kept while the device could not be bound (device guard) is opened now. */
  private resumePostponedFlow(): void {
    if (!this.router.url?.startsWith('/tabs/')) return;
    const pending = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    if (pending) {
      void this.router.navigateByUrl(takePendingDeepLink() || WALLET_HOME);
    }
  }

  private resetDeviceRetry(): void {
    this.clearDeviceRetry();
    this.deviceRetryAttempt = 0;
    this._deviceUnavailable.set(false);
  }

  private clearDeviceRetry(): void {
    if (this.deviceRetryTimer) {
      clearTimeout(this.deviceRetryTimer);
      this.deviceRetryTimer = null;
    }
  }

  /**
   * The device was just registered and the session bound to it: the attestations of the session can be loaded
   * now (FR-06). Resolves once they are in the local store.
   */
  deviceRegistered(): Promise<void> {
    const account = this.accountId();
    if (account) {
      this.deviceState = { epoch: this.epoch, account, state: Promise.resolve('bound') };
    }
    this.resetDeviceRetry();
    // The other tabs share the session: they bind again instead of asking to register it too.
    this.broadcastChannel.postMessage(DEVICE_REGISTERED_MESSAGE);
    this.sessionData = this.serverSessionData.sessionStarted();
    return this.sessionData;
  }

  /**
   * A 403 `instance_required` (design §2.2): binds the session once more. If this Wallet App has no active
   * device of the account any more, it goes to "Registrar este dispositivo" and the call is not retried.
   */
  override recoverDevice(): Observable<boolean> {
    if (!this.isLoggedIn()) {
      return of(false);
    }
    if (!this.deviceRecovery) {
      this.deviceState = null;
      this.deviceRecovery = this.deviceReady()
        .then(state => {
          if (state === 'unregistered') {
            this.goToDeviceRegistration();
          }
          return state === 'bound';
        })
        .finally(() => { this.deviceRecovery = null; });
    }
    return from(this.deviceRecovery);
  }

  /** "Registrar este dispositivo", keeping the screen the user was on to come back to it afterwards. */
  private goToDeviceRegistration(): void {
    const current = this.router.url;
    if (current?.startsWith(REGISTER_DEVICE_ROUTE)) return;
    if (current && current !== '/') {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, current);
    }
    void this.router.navigateByUrl(REGISTER_DEVICE_ROUTE);
  }

  /** Attestations of the session, once it is bound to its device: never before (FR-06). */
  private loadSessionData(fromOtherTab = false): Promise<void> {
    return this.deviceReady().then(state => {
      if (state === 'bound') {
        return this.serverSessionData.sessionStarted();
      }
      if (state === 'unregistered' && fromOtherTab) {
        // This tab was in the wallet: the new session has no device here yet.
        this.goToDeviceRegistration();
      }
      // Nothing loads before the device is bound (FR-06); on 'unavailable' it loads once the retry binds it. A
      // session opened by another tab may be of another account: the copy of the previous one is never shown.
      return state === 'unregistered' || fromOtherTab ? this.serverSessionData.sessionEnded() : undefined;
    });
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
    this.resume ??= this.runResume().finally(() => this.initialized$.next(true));
    return this.resume;
  }

  // --- Token management ---

  refreshAccessToken(options?: { onAuthFailure?: AuthFailureMode }): Observable<AccessTokenResponse> {
    if (this.refreshInFlight?.epoch === this.epoch) {
      return this.refreshInFlight.renewal$;
    }
    const epoch = this.epoch;
    const onAuthFailure = options?.onAuthFailure ?? 'force-logout';
    const renewal$: Observable<AccessTokenResponse> = defer(() => this.withRefreshLock(
      () => firstValueFrom(this.http.post<SessionResponse>(`${this.authBase}/refresh`, null))
    )).pipe(
      map(session => {
        // A logout, another tab or a new sign-in changed the session meanwhile: never revive it.
        if (this.disposed || epoch !== this.epoch) {
          throw new SessionChangedError();
        }
        this.applySession(session);
        return session;
      }),
      catchError(err => {
        if (!this.disposed && !(err instanceof SessionChangedError) && epoch === this.epoch) {
          this.handleRefreshFailure(err, onAuthFailure);
        }
        return throwError(() => err);
      }),
      // Reset when the request itself settles, not when a caller unsubscribes.
      finalize(() => {
        if (this.refreshInFlight?.renewal$ === renewal$) {
          this.refreshInFlight = null;
        }
      }),
      // refCount: false — a caller leaving early must not cancel a rotation the
      // service may already have applied, or the new cookie's token would be lost.
      shareReplay({ bufferSize: 1, refCount: false })
    );
    this.refreshInFlight = { epoch, renewal$ };
    return renewal$;
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
   * A signed-in session that let its access token expire renews it before an
   * API call is sent, instead of sending the call without a token. During a
   * backoff after a temporary failure the call goes out as is.
   */
  override whenAccessTokenReady(): Observable<void> {
    if (!this.isLoggedIn() || this.accessToken) {
      return of(undefined);
    }
    if (!this.refreshInFlight && this.inRenewalBackoff()) {
      return of(undefined);
    }
    return this.refreshAccessToken().pipe(
      map(() => undefined),
      catchError(() => of(undefined))
    );
  }

  /**
   * Ends the session (FR-20): locally at once (here and in the other tabs), and
   * in the service with `DELETE /auth/sessions/current`. A token that is missing
   * or about to expire is renewed first, and a 401 is answered with one renewal
   * and a retry. If the service cannot confirm it for a temporary reason,
   * `serverLogoutPending()` stays true, the start-up resume will not revive the
   * session, and the logout is retried when the connection returns. Never errors.
   */
  logout(): Observable<void> {
    if (!this.isLoggedIn()) {
      this.endSessionLocally();
      return of(undefined);
    }
    const token = this.usableAccessToken();
    this.setServerLogoutPending(true);
    this.endSessionLocally();
    this.broadcastSessionEnded(false);
    return from(this.endServerSession(token));
  }

  /** The session is no longer valid: forget it here and in the other tabs, and go to the access screen. */
  forceLogout(options?: ForceLogoutOptions): void {
    if (this.disposed) return;
    const expired = options?.sessionExpired === true;
    this.endSessionLocally();
    this.broadcastSessionEnded(expired);
    this.sessionExpiredNotice = expired;
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
    this.clearDeviceRetry();
    this.subscriptions.unsubscribe();
    this.broadcastChannel.close();
  }

  ngOnDestroy(): void {
    this.dispose();
  }

  // --- Start-up resume ---

  private async runResume(): Promise<boolean> {
    if (this._serverLogoutPending()) {
      // The user logged out and the service never confirmed it: finish that, never resume.
      await this.endServerSession(null);
      await this.serverSessionData.sessionEnded();
      return false;
    }
    if (!readSessionInTab()) {
      // Reopened, not reloaded: the user signs in again with the passkey. The
      // cookie's session is left alone, another tab may be using it.
      return false;
    }
    return this.attemptResume(true);
  }

  /** One renewal attempt of the start-up resume; a temporary failure is retried once, in sequence. */
  private async attemptResume(canRetry: boolean): Promise<boolean> {
    try {
      await firstValueFrom(this.refreshAccessToken({ onAuthFailure: 'clear-only' }));
      this.sessionData = this.loadSessionData();
      await this.sessionData;
      return true;
    } catch (err) {
      if (err instanceof SessionChangedError) {
        return this.isLoggedIn();
      }
      if (isRefreshTokenRejected(err)) {
        // No session to resume: the local attestations belong to one that has ended.
        await this.serverSessionData.sessionEnded();
        return false;
      }
    }
    if (canRetry) {
      await this.waitForConnectionOrDelay(RESUME_RETRY_DELAY_MS);
      return this.attemptResume(false);
    }
    // Still offline or failing: show the access screen, keep the local attestations
    // (the session may be alive) and try again when the connection returns.
    this.resumeDeferred = true;
    return false;
  }

  private waitForConnectionOrDelay(ms: number): Promise<unknown> {
    return firstValueFrom(race(fromEvent(window, 'online'), timer(ms)));
  }

  /** A start-up resume deferred by a temporary failure, retried in the background when back online. */
  private retryDeferredResume(): void {
    if (!this.resumeDeferred || this.isLoggedIn()) return;
    this.resumeDeferred = false;
    this.refreshAccessToken({ onAuthFailure: 'clear-only' }).subscribe({
      next: () => {
        this.sessionData = this.loadSessionData();
        if (this.router.url?.startsWith(ACCESS_ROUTE)) {
          void this.router.navigateByUrl(takePendingDeepLink() || WALLET_HOME);
        }
      },
      error: err => {
        if (isRefreshTokenRejected(err)) {
          void this.serverSessionData.sessionEnded();
        } else if (!(err instanceof SessionChangedError)) {
          this.resumeDeferred = true;
        }
      },
    });
  }

  // --- Logout in the service ---

  private usableAccessToken(): string | null {
    return this.accessToken && Date.now() < this.accessTokenExpiresAt - LOGOUT_TOKEN_MARGIN_MS
      ? this.accessToken
      : null;
  }

  /** Single-flight: a logout already being confirmed is joined, not repeated. Never rejects. */
  private endServerSession(token: string | null): Promise<void> {
    this.logoutInFlight ??= this.confirmServerLogout(token).finally(() => { this.logoutInFlight = null; });
    return this.logoutInFlight;
  }

  private async confirmServerLogout(token: string | null): Promise<void> {
    try {
      if (!token || !(await this.deleteCurrentSession(token))) {
        const renewed = await this.renewForLogout();
        // null: the service no longer holds the session; a second 401 means the same.
        if (renewed) {
          await this.deleteCurrentSession(renewed);
        }
      }
      this.setServerLogoutPending(false);
    } catch (err) {
      // Offline, 5xx, 429, or a renewal refused for a reason other than an ended session:
      // not confirmed. The pending flag stays and `online` retries.
      console.warn('[RemoteAuthService] The service could not confirm the logout yet', err);
    }
  }

  /** `true` once ended; `false` on 401 (stale token: renew and retry); throws on a temporary failure. */
  private async deleteCurrentSession(token: string): Promise<boolean> {
    try {
      await firstValueFrom(this.http.delete<void>(`${this.authBase}/sessions/current`, {
        headers: new HttpHeaders({ Authorization: `Bearer ${token}` }),
      }), { defaultValue: undefined });
      return true;
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401) {
        return false;
      }
      throw err;
    }
  }

  /** A fresh access token for the logout only (no session is applied, no UI): `null` if the session is over. */
  private async renewForLogout(): Promise<string | null> {
    try {
      const session = await this.withRefreshLock(
        () => firstValueFrom(this.http.post<SessionResponse>(`${this.authBase}/refresh`, null))
      );
      return session.accessToken;
    } catch (err) {
      if (isRefreshTokenRejected(err)) {
        return null;
      }
      throw err;
    }
  }

  private setServerLogoutPending(pending: boolean): void {
    this._serverLogoutPending.set(pending);
    if (pending) {
      localStorage.setItem(SERVER_LOGOUT_PENDING_KEY, '1');
    } else {
      localStorage.removeItem(SERVER_LOGOUT_PENDING_KEY);
    }
  }

  // --- Private helpers ---

  private openSession(result: PasskeySession): void {
    if (this.disposed) return;
    this.epoch++;
    this.registrationTicket.clear();
    // Opening a session ends the one of the cookie in the service (FR-21): nothing left to log out.
    this.setServerLogoutPending(false);
    this.resumeDeferred = false;
    this.applySession(result.session, result.credentialId);
    this.broadcastChannel.postMessage(SESSION_OPENED_MESSAGE);
    this.sessionData = this.loadSessionData();
    void this.signalPasskeyState(result);
    void this.preloadIssuerMetadata();
  }

  private applySession(session: SessionResponse, credentialId?: string): void {
    if (this.disposed) return;
    const now = Date.now();
    this.accessToken = session.accessToken;
    this.accessTokenExpiresAt = now + session.expiresIn * 1000;
    this.lastRenewalAt = now;
    this.renewalFailures = 0;
    this.renewalBlockedUntil = 0;
    this.sessionPasskey.set(session.passkeyId, credentialId ?? null);
    this.name$.next(readEmailClaim(session.accessToken));
    this.accountSub = readClaim(session.accessToken, 'sub');
    this.authenticated$.next(true);
    writeSessionInTab(true);
    this.scheduleRenewal();
  }

  /**
   * A renewal runs at most every token lifetime, and only with activity since
   * the last one. Without activity the token is dropped at expiry; the next
   * activity (or an API call) renews it if the session is alive.
   */
  private scheduleRenewal(): void {
    this.clearTimers();
    const renewAt = this.accessTokenExpiresAt - RENEW_BEFORE_EXPIRY_MS;
    this.renewTimer = setTimeout(() => {
      this.renewTimer = null;
      if (this.hasActivitySinceRenewal()) {
        this.renewInBackground();
        return;
      }
      this.expiryTimer = setTimeout(() => {
        this.expiryTimer = null;
        this.accessToken = null;
      }, Math.max(this.accessTokenExpiresAt - Date.now(), 0));
    }, Math.max(renewAt - Date.now(), 0));
  }

  private hasActivitySinceRenewal(): boolean {
    return this.lastActivityAt > this.lastRenewalAt;
  }

  private inRenewalBackoff(): boolean {
    return Date.now() < this.renewalBlockedUntil;
  }

  /** Background renewal (timer, activity, page hidden): skipped while backing off after a temporary failure. */
  private renewInBackground(): void {
    if (this.inRenewalBackoff() && !this.refreshInFlight) return;
    this.refreshAccessToken({ onAuthFailure: 'force-logout' }).subscribe({
      // A rejected renewal already went to the access screen with the notice;
      // a temporary one backs off and is retried with the next activity.
      error: () => undefined,
    });
  }

  /**
   * Only a rejected renewal ends the session, and only a signed-in user is sent
   * to the access screen with the expired notice. A temporary failure keeps the
   * session (the service may still hold it) and backs the next renewals off.
   */
  private handleRefreshFailure(err: unknown, onAuthFailure: AuthFailureMode): void {
    if (!isRefreshTokenRejected(err)) {
      this.renewalFailures++;
      const delay = Math.min(RENEW_BACKOFF_BASE_MS * 2 ** (this.renewalFailures - 1), RENEW_BACKOFF_MAX_MS);
      this.renewalBlockedUntil = Date.now() + delay;
      return;
    }
    if (onAuthFailure === 'force-logout' && this.isLoggedIn()) {
      this.forceLogout({ sessionExpired: true });
    } else {
      this.endSessionLocally();
    }
  }

  private async withRefreshLock<T>(renew: () => Promise<T>): Promise<T> {
    const locks = (navigator as Navigator & { locks?: WebLocks }).locks;
    return locks ? locks.request(SESSION_REFRESH_LOCK, renew) : renew();
  }

  private endSessionLocally(): void {
    const wasActive = this.isLoggedIn() || this.accessToken !== null;
    this.epoch++;
    this.clearTimers();
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
    this.lastActivityAt = 0;
    this.name$.next('');
    this.accountSub = null;
    this.deviceState = null;
    this.resetDeviceRetry();
    this.authenticated$.next(false);
    this.registrationTicket.clear();
    this.sessionPasskey.clear();
    writeSessionInTab(false);
    if (wasActive) {
      void this.serverSessionData.sessionEnded();
    }
  }

  private onOnline(): void {
    if (this.disposed) return;
    this.renewalBlockedUntil = 0;
    if (this._serverLogoutPending() && !this.isLoggedIn()) {
      void this.endServerSession(null);
      return;
    }
    this.retryDeferredResume();
    if (this.isLoggedIn() && (!this.accessToken || this.hasActivitySinceRenewal())) {
      this.renewInBackground();
    }
  }

  /**
   * Inactivity is measured by the service from the last renewal, so activity
   * since then would be lost if the tab is closed or backgrounded before the
   * next one (AC-14). When the page is hidden with activity pending, renew right
   * away with a normal request. Known limits: `sendBeacon`/`keepalive` cannot
   * carry the `X-Wallet-Request` header, so a renewal still running when the
   * page is discarded may not reach the service; and activity in the last
   * moments before an abrupt close (crash, killed process) is not reported.
   */
  private onPageHidden(): void {
    if (this.disposed || !this.isLoggedIn() || !this.hasActivitySinceRenewal()) return;
    this.renewInBackground();
  }

  /**
   * On a shared device the attestation copies of a session that has ended must
   * not stay in IndexedDB until the next start-up. Best effort: the browser may
   * not finish the deletion before the page goes away.
   */
  private onPageHide(): void {
    if (this.disposed) return;
    this.onPageHidden();
    if (this.initialized$.getValue() && !this.isLoggedIn()) {
      void this.serverSessionData.sessionEnded();
    }
  }

  /** Signal API (FR-17), best effort: which passkeys the account has and its current email. */
  private async signalPasskeyState(result: PasskeySession): Promise<void> {
    if (!result.userId) return;
    try {
      const passkeys = await firstValueFrom(this.passkeyApi.listPasskeys());
      // A list without the session's passkey is not this account's current one: signalling it
      // would make the passkey manager hide the passkey that was just used.
      if (passkeys.some(passkey => passkey.id === result.session.passkeyId)) {
        await this.webAuthnBrowser.signalAllAcceptedCredentials(
          result.rpId, result.userId, passkeys.map(passkey => passkey.credentialId)
        );
      }
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
   * ends the session this one ends too (with the expired notice if it expired);
   * when another tab opens a session, this one drops its token and resumes the
   * new session.
   */
  private listenToOtherTabs(): void {
    this.broadcastChannel.onmessage = (event: MessageEvent) => {
      if (this.disposed) return;
      const data = event.data as SessionEndedMessage | string;
      if (typeof data === 'object' && data?.type === SESSION_ENDED_MESSAGE) {
        this.onOtherTabSessionEnded(data);
      } else if (data === DEVICE_REGISTERED_MESSAGE) {
        this.onOtherTabDeviceRegistered();
      } else if (data === SESSION_OPENED_MESSAGE) {
        this.onOtherTabSessionOpened();
      }
    };
  }

  private onOtherTabSessionEnded(message: SessionEndedMessage): void {
    if (message.expired) {
      this.sessionExpiredNotice = true;
    }
    this.resumeDeferred = false;
    if (!this.isLoggedIn()) return;
    this.endSessionLocally();
    void this.router.navigateByUrl(ACCESS_ROUTE);
  }

  /** Another tab registered the device: this one leaves the registration step once bound to it. */
  private onOtherTabDeviceRegistered(): void {
    if (!this.isLoggedIn()) return;
    this.deviceState = null;
    if (!this.router.url?.startsWith(REGISTER_DEVICE_ROUTE)) return;
    void this.deviceReady().then(state => {
      if (state === 'bound') {
        this.sessionData = this.serverSessionData.sessionStarted();
        void this.router.navigateByUrl(takePendingDeepLink() || WALLET_HOME);
      }
    });
  }

  /** Another tab opened a session, maybe of another account: the binding of this one is not valid now. */
  private onOtherTabSessionOpened(): void {
    this.deviceState = null;
    this.resetDeviceRetry();
    if (!this.isLoggedIn() && !this.resumeDeferred) return;
    this.epoch++;
    this.accessToken = null;
    this.sessionPasskey.clear();
    this.resumeDeferred = false;
    this.setServerLogoutPending(false);
    this.refreshAccessToken({ onAuthFailure: 'force-logout' }).subscribe({
      next: () => { this.sessionData = this.loadSessionData(true); },
      error: () => undefined,
    });
  }

  private broadcastSessionEnded(expired: boolean): void {
    if (!this.disposed) {
      this.broadcastChannel.postMessage({ type: SESSION_ENDED_MESSAGE, expired } satisfies SessionEndedMessage);
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
  return readClaim(accessToken, 'email') ?? '';
}

/** A string claim of the access token, or `null`. The service validates the token, not this app. */
function readClaim(accessToken: string, claim: 'email' | 'sub'): string | null {
  try {
    const payload = JSON.parse(base64UrlToText(accessToken.split('.')[1])) as Record<string, unknown>;
    const value = payload[claim];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}

/** Base64url → UTF-8 text (`atob` alone returns Latin-1 and garbles non-ASCII emails). */
function base64UrlToText(segment: string): string {
  const base64 = segment.replaceAll('-', '+').replaceAll('_', '/');
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
  // `atob` yields one char per byte (0–255), so the code point is the byte value.
  return new TextDecoder().decode(Uint8Array.from(binary, char => char.codePointAt(0) as number));
}

/** sessionStorage can throw (blocked storage): no marker then, so nothing is resumed. */
function readSessionInTab(): boolean {
  try {
    return sessionStorage.getItem(SESSION_IN_TAB_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSessionInTab(open: boolean): void {
  try {
    if (open) {
      sessionStorage.setItem(SESSION_IN_TAB_KEY, '1');
    } else {
      sessionStorage.removeItem(SESSION_IN_TAB_KEY);
    }
  } catch {
    // Blocked storage: the session simply is not resumed after a reload.
  }
}
