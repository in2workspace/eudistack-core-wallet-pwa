import { Component, DestroyRef, OnDestroy, computed, inject, signal, ViewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom, take } from 'rxjs';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { PasskeyApiService } from 'src/app/core/services/passkey-api.service';
import { compareCredentialIds } from 'src/app/core/utils/base64url';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { OtpInputComponent } from 'src/app/shared/components/otp-input/otp-input.component';
import { WalletService } from 'src/app/core/services/wallet.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';

const RESEND_COOLDOWN_SECONDS = 180;

// Reassures the user that initialization is still progressing.
const INIT_SLOW_THRESHOLD_MS = 3000;
// Above PwaInstallService's own hard ceiling (INSTALL_DECISION_HARD_TIMEOUT_MS):
// a safety net in case something other than installDecision$ hangs.
const INIT_FAIL_THRESHOLD_MS = 8000;

type WatermarkShape = 'access' | 'email' | 'verify' | 'passkey';

const WATERMARK_ASSETS: Record<WatermarkShape, string> = {
  access: 'assets/svg/download-solid.svg',
  email: 'assets/svg/user-solid.svg',
  verify: 'assets/svg/envelope-circle-check-solid.svg',
  passkey: 'assets/svg/door-open-solid.svg',
};

const WATERMARK_VIEWBOX_WIDTH = 672;

const WATERMARK_CROP_TOP = 200;

/**
 * Whether the code the user holds can still be checked (#1061173, W-17): `expired`
 * (401 `expired_code`) and `exhausted` (429 `too_many_attempts`, its 5 attempts used up)
 * both need a new code, so Continue stays disabled and Resend is offered right away.
 */
type CodeState = 'active' | 'expired' | 'exhausted';

/**
 * A 429 + Retry-After from EBW (RateLimitWebFilter / EmailRateLimiter): until `until`
 * no new code can be sent to `email` and, when it came from verify-email, no code can be
 * checked either. Kept as a deadline per email, apart from the visual countdown, so going
 * Back or leaving the page doesn't offer a request the server will reject, while another
 * email can still be tried.
 */
interface RateLimit {
  email: string;
  until: number;
  blocksVerify: boolean;
}

const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

@Component({
    selector: 'app-login',
    templateUrl: './login.page.html',
    styleUrl: './login.page.scss',
  imports: [CommonModule, FormsModule, IonicModule, OtpInputComponent, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage implements OnDestroy {
  @ViewChild('otpRef') otpInput!: OtpInputComponent;

  private readonly themeService = inject(ThemeService);
  private readonly pwaInstall = inject(PwaInstallService);
  private readonly installDecision = toSignal(this.pwaInstall.installDecision$);
  private readonly theme = toSignal(this.themeService.getTheme());
  loading = false;
  errorMessage = '';
  /** Neutral notice for expected outcomes (e.g. the user dismissed the passkey prompt). */
  noticeMessage = '';
  readonly showInstallScreen = signal(!this.pwaInstall.isStandalone);
  showHelpModal = false;
  showMacStepsModal = false;

  readonly helpFaqs = [
    { question: 'auth.access.help.q1', answer: 'auth.access.help.a1' },
    { question: 'auth.access.help.q2', answer: 'auth.access.help.a2' },
    { question: 'auth.access.help.q3', answer: 'auth.access.help.a3' },
  ];

  readonly initTakingLong = signal(false);
  readonly initFailed = signal(false);
  // Set by retryInit() when installDecision$ never settled even past the fail
  // threshold: installDecision$ is a shareReplay({ refCount: false }), so a
  // fresh subscription cannot "restart" it — the only way out without a full
  // reload is to stop waiting on it and treat the decision as resolved (false).
  private readonly forceReady = signal(false);
  private slowInitTimer: ReturnType<typeof setTimeout> | null = null;
  private failInitTimer: ReturnType<typeof setTimeout> | null = null;

  // Server mode: multi-step flow
  readonly email = signal('');
  readonly otpValue = signal('');
  readonly step = signal<'email' | 'code' | 'passkey'>('email');
  needsPasskeySetup = false;
  deviceName = '';
  private matchedPasskeyId: string | null = null;
  private passkeyRetryTimer: ReturnType<typeof setTimeout> | null = null;
  readonly codeState = signal<CodeState>('active');
  // Deadlines (epoch ms) behind the resend countdown; `now` is refreshed by `ticker`
  // only while one of them is still ahead.
  private readonly resendAvailableAt = signal(0);
  private readonly rateLimit = signal<RateLimit | null>(null);
  private readonly now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;
  private passkeyFromRefreshToken = false;

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly passkeyApi = inject(PasskeyApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly walletService = inject(WalletService);
  private readonly activityService = inject(ActivityService);
  private readonly credentialCache = inject(CredentialCacheService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isBrowserMode = this.authService instanceof LocalAuthService;
  readonly isMacSafari = this.pwaInstall.isMacSafari;
  readonly macInstallSteps = ['step-1', 'step-2', 'step-3'] as const;
  readonly hasExistingPasskey = this.prfService.hasPasskey();

  // EUD bug: Edge on Windows takes a request with no `authenticatorAttachment`
  // straight to the Windows Hello PIN prompt and never offers the cross-device
  // (QR) option that Chrome's account chooser shows for the same request. The
  // `hints` sent with every WebAuthn call (see webauthn.constants.ts) narrow
  // that gap, but Edge's native picker is outside our control — so on that
  // specific combination we tell the user what to expect up front instead of
  // letting them read a Windows-only PIN prompt as the app being broken.
  readonly showEdgeWindowsPasskeyHint = /Windows/.test(navigator.userAgent) && /Edg\//.test(navigator.userAgent);

  readonly brandName = computed(() => {
    const name = this.theme()?.branding?.name?.trim();
    return name ? name.split(' ')[0] : 'Wallet';
  });

  readonly screen = computed<'checking' | 'access' | 'browser' | 'email' | 'code' | 'passkey'>(() => {
    const decision = this.forceReady() ? false : this.installDecision();
    if (decision === undefined) return 'checking';
    if (decision && this.showInstallScreen()) return 'access';
    if (this.isBrowserMode) return 'browser';
    return this.step();
  });

  readonly canGoBack = computed(() => {
    const screen = this.screen();
    return screen === 'code' || screen === 'passkey';
  });

  readonly watermark = computed<WatermarkShape | null>(() => {
    switch (this.screen()) {
      case 'checking': return null;
      case 'access': return 'access';
      case 'code': return 'verify';
      case 'browser':
      case 'passkey': return 'passkey';
      default: return 'email';
    }
  });


  readonly watermarkStyle = computed((): Record<string, string> => {
    const shape = this.watermark();
    if (!shape) return { display: 'none' };

    const image = `url('${new URL(WATERMARK_ASSETS[shape], document.baseURI).href}')`;
    const position = `left calc(var(--wm-width) * ${WATERMARK_CROP_TOP} / -${WATERMARK_VIEWBOX_WIDTH})`;

    return {
      'mask-image': image,
      'mask-repeat': 'no-repeat',
      'mask-size': 'contain',
      'mask-position': position,
    };
  });

  /** The rate limit that applies to the email currently typed, if it hasn't run out yet. */
  private readonly activeRateLimit = computed(() => {
    const rateLimit = this.rateLimit();
    return rateLimit && sameEmail(rateLimit.email, this.email()) && this.now() < rateLimit.until ? rateLimit : null;
  });

  readonly rateLimited = computed(() => this.activeRateLimit() !== null);

  readonly verifyRateLimited = computed(() => this.activeRateLimit()?.blocksVerify ?? false);

  readonly resendSecondsLeft = computed(() => {
    const until = Math.max(this.resendAvailableAt(), this.activeRateLimit()?.until ?? 0);
    return Math.max(0, Math.ceil((until - this.now()) / 1000));
  });

  /** Single gate for Continue and verifyCode(), which the OTP `completed` event also reaches. */
  readonly canSubmitCode = computed(() =>
    this.otpValue().length === 6 && this.codeState() === 'active' && !this.verifyRateLimited());

  readonly resendCountdown = computed(() => {
    const total = this.resendSecondsLeft();
    // A 429 cooldown is driven by the backend's Retry-After (its rate-limit
    // window, e.g. 1h — see RateLimitWebFilter), which can run well past the
    // few minutes the plain mm:ss format was designed for.
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  ionViewWillEnter(): void {
    this.loading = false;
    this.clearMessages();
    this.forceReady.set(false);
    this.startInitWatchdog();
    // A rate limit outlives leaving the page: resume its countdown.
    this.startTicker();

    if (!this.isBrowserMode && localStorage.getItem('wallet_refresh_token')) {
      this.step.set('passkey');
      this.passkeyFromRefreshToken = true;
      this.needsPasskeySetup = !this.prfService.hasPasskey();
      if (this.needsPasskeySetup) {
        this.deviceName = this.getDeviceName();
      }
    } else {
      this.step.set('email');
      this.passkeyFromRefreshToken = false;
      this.needsPasskeySetup = false;
    }
  }

  ionViewWillLeave(): void {
    this.teardownTimers();
  }

  ngOnDestroy(): void {
    this.teardownTimers();
  }

  /**
   * Cancels every pending timer this page owns (resend cooldown, init watchdog, passkey retry).
   * The rate-limit deadline is kept: the server keeps rejecting until then.
   */
  private teardownTimers(): void {
    this.resendAvailableAt.set(0);
    this.stopTicker();
    this.clearInitWatchdog();
    this.clearPasskeyRetryTimer();
  }

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
    this.showInstallScreen.set(false);
  }

  skipInstall(): void {
    this.showInstallScreen.set(false);
  }

  openHelp(): void {
    this.showHelpModal = true;
  }

  closeHelp(): void {
    this.showHelpModal = false;
  }

  openMacSteps(): void {
    this.showMacStepsModal = true;
  }

  closeMacSteps(): void {
    this.showMacStepsModal = false;
  }

  // --- Initialization watchdog ---

  /**
   * Guards against installDecision$ (or any future init dependency) never
   * settling: escalates the spinner to a "taking longer" message and, past
   * INIT_FAIL_THRESHOLD_MS, to a friendly error screen. retryInit() from that
   * screen forces past the stuck probe (see forceReady) rather than merely
   * re-arming these timers, so it recovers without a manual browser refresh.
   */
  private startInitWatchdog(): void {
    this.clearInitWatchdog();
    this.initTakingLong.set(false);
    this.initFailed.set(false);

    this.slowInitTimer = setTimeout(() => this.initTakingLong.set(true), INIT_SLOW_THRESHOLD_MS);
    this.failInitTimer = setTimeout(() => this.initFailed.set(true), INIT_FAIL_THRESHOLD_MS);

    this.pwaInstall.installDecision$.pipe(
      take(1),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.clearInitWatchdog());
  }

  private clearInitWatchdog(): void {
    if (this.slowInitTimer) clearTimeout(this.slowInitTimer);
    if (this.failInitTimer) clearTimeout(this.failInitTimer);
    this.slowInitTimer = null;
    this.failInitTimer = null;
  }

  retryInit(): void {
    // installDecision$ is shareReplay({ refCount: false }): resubscribing does not
    // restart its race, so simply re-arming the watchdog can't recover a stuck probe.
    // Once we've actually shown the failure screen, stop waiting on it and proceed
    // as if it had resolved to false (no install screen, straight to login).
    if (this.initFailed()) {
      this.forceReady.set(true);
    }
    this.startInitWatchdog();
  }

  reloadApp(): void {
    window.location.reload();
  }

  // --- Browser mode: single-step passkey login ---

  async loginBrowserMode(): Promise<void> {
    this.loading = true;
    this.clearMessages();

    try {
      await this.authenticateLocally();
      (this.authService as LocalAuthService).markAuthenticated();
      this.navigateHome();
    } catch (err: unknown) {
      this.showPasskeyFailure(err);
    } finally {
      this.loading = false;
    }
  }

  // --- Browser mode: passkey creation (register) ---

  async createWalletBrowserMode(): Promise<void> {
    this.loading = true;
    this.clearMessages();
    try {
      await (this.authService as LocalAuthService).setupPasskey();
      this.navigateHome();
    } catch (err: unknown) {
      this.showPasskeyFailure(err);
    } finally {
      this.loading = false;
    }
  }

  // --- Server mode: email + OTP + passkey flow ---

  onOtpCompleted(code: string): void {
    if (!this.loading) {
      this.otpValue.set(code);
      this.verifyCode();
    }
  }

  /**
   * While the code can't be checked, typing doesn't clear the message explaining why,
   * so the user isn't left with a silently ignored code.
   */
  onOtpChanged(code: string): void {
    this.otpValue.set(code);
    if (this.codeState() === 'active' && !this.verifyRateLimited()) {
      this.errorMessage = '';
    }
  }

  /**
   * Leaves the code step with a clean slate, except for a rate limit: the server keeps
   * rejecting that email until Retry-After, so its countdown stays on Send code — typing
   * another email lifts it.
   */
  goBackToEmail(): void {
    this.step.set('email');
    this.clearMessages();
    this.otpValue.set('');
    this.codeState.set('active');
    this.resendAvailableAt.set(0);
  }

  sendCode(): void {
    if (!this.email() || this.loading || this.resendSecondsLeft() > 0) return;

    this.loading = true;
    this.clearMessages();

    (this.authService as RemoteAuthService).register(this.email(), 'login').pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.step.set('code');
        this.otpValue.set('');
        this.codeState.set('active');
        this.loading = false;
        this.startResendCountdown();
      },
      error: (err) => this.handleSendCodeError(err)
    });
  }

  resendCode(): void {
    if (this.loading || this.resendSecondsLeft() > 0) return;

    this.loading = true;
    this.clearMessages();

    (this.authService as RemoteAuthService).register(this.email(), 'login').pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.otpValue.set('');
        this.otpInput?.reset();
        this.codeState.set('active');
        this.loading = false;
        this.startResendCountdown();
      },
      error: (err) => this.handleSendCodeError(err)
    });
  }

  /**
   * Shared by sendCode() and resendCode(): on a 429 the send/resend button must
   * stop being clickable for as long as the backend will keep rejecting it
   * (RateLimitWebFilter), not just show a message the user can immediately
   * dismiss by clicking again. Retry-After carries that real cooldown; fall
   * back to the existing resend window if it's ever missing.
   *
   * Retry-After is readable because the PWA calls EBW on its own origin (`server_url`
   * is empty, so `/business-wallet/api/*` is routed by nginx locally and by CloudFront
   * in DEV/PRO): no CORS header exposure is involved.
   */
  private handleSendCodeError(err: any): void {
    if (err?.status === 429) {
      this.errorMessage = this.translate.instant('auth.errors.too-many-attempts');
      this.applyRateLimit(this.parseRetryAfterSeconds(err), false);
    } else {
      this.errorMessage = err?.error?.message || err?.error?.detail || 'Failed to send verification code';
    }
    this.loading = false;
  }

  private parseRetryAfterSeconds(err: any): number {
    const header = err?.headers?.get?.('Retry-After');
    const seconds = Number(header);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : RESEND_COOLDOWN_SECONDS;
  }

  verifyCode(): void {
    if (!this.canSubmitCode() || this.loading) return;

    this.loading = true;
    this.clearMessages();

    (this.authService as RemoteAuthService).verifyEmail(this.email(), this.otpValue()).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.resendAvailableAt.set(0);
        this.rateLimit.set(null);
        this.stopTicker();
        this.passkeyFromRefreshToken = false;
        this.resolvePasskeySetupStep();
      },
      error: (err) => this.handleVerifyCodeError(err)
    });
  }

  /**
   * An expired code (401 `expired_code`) or an exhausted attempt budget (429
   * `too_many_attempts`) means the current OTP can never succeed, so any leftover resend
   * cooldown is dropped and the user stays on the code step with the same email, one click
   * away from a fresh code (#1061173).
   *
   * Any other 429 is the per-email/IP rate limit (RateLimitWebFilter / EmailRateLimiter,
   * ProblemDetail + Retry-After): a new code would be rejected too, so asking for one would
   * contradict the disabled resend (W-17). The message asks the user to wait instead, and
   * the resend countdown follows Retry-After.
   */
  private handleVerifyCodeError(err: any): void {
    const errorCode = err?.error?.error;
    if (err?.status === 401 && errorCode === 'expired_code') {
      this.discardCode('expired');
      this.errorMessage = this.translate.instant('auth.errors.otp-expired');
    } else if (err?.status === 429 && errorCode === 'too_many_attempts') {
      this.discardCode('exhausted');
      this.errorMessage = this.translate.instant('auth.errors.too-many-attempts-otp');
    } else if (err?.status === 429) {
      this.applyRateLimit(this.parseRetryAfterSeconds(err), true);
      this.errorMessage = this.translate.instant('auth.errors.too-many-attempts-wait');
    } else if (err?.status === 401 && errorCode === 'invalid_code') {
      this.errorMessage = this.translate.instant('auth.errors.otp-invalid');
    } else {
      this.errorMessage = err?.error?.message || err?.error?.detail || 'Invalid verification code';
    }
    this.loading = false;
  }

  /**
   * The local `has_passkey` flag (PasskeyStoreService/IndexedDB) is per-browser,
   * not per-account: it stays `true` after a different account onboarded a passkey
   * on the same device. Right after verify-email we already hold a JWT for the
   * account being authenticated, so we check whether THIS device's local
   * credential is among the account's server-side passkeys instead of trusting
   * the local flag alone (EUD-8 tech-debt: onboarding skipped device registration
   * when the browser had a stale passkey from another account).
   *
   * Checking `passkeys.length === 0` alone is not enough: an account can already
   * have passkeys registered on OTHER devices, and this device's local credential
   * (if any) must still be found among them, or `verifyPasskey()` will fail with
   * "No passkey found" / a WebAuthn assertion error with no way to register instead.
   */
  private resolvePasskeySetupStep(retriedAfterError = false): void {
    const localCredentialId = this.prfService.getCredentialId();

    this.passkeyApi.listPasskeys().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (passkeys) => {
        const matched = passkeys.find(passkey => compareCredentialIds(passkey.credentialId, localCredentialId));
        this.matchedPasskeyId = matched?.id ?? null;
        this.needsPasskeySetup = !localCredentialId || !matched;
        this.finishPasskeySetupStep();
      },
      error: (err) => {
        // A single network/5xx blip here used to force needsPasskeySetup=true
        // immediately, repeating device registration for a transient failure
        // unrelated to whether the passkey is actually still registered.
        // Retry once; the timer is cancelled on view leave/destroy.
        if (!retriedAfterError) {
          console.warn('[LoginPage] listPasskeys failed, retrying once', err);
          this.clearPasskeyRetryTimer();
          this.passkeyRetryTimer = setTimeout(() => this.resolvePasskeySetupStep(true), 1000);
          return;
        }
        // Fail-safe after the retry: could not confirm the account's server-side
        // devices, so assume registration is needed. Drop any stale matched id so
        // a later confirm-session cannot reuse it.
        console.warn('[LoginPage] listPasskeys failed twice, defaulting to needsPasskeySetup=true', err);
        this.matchedPasskeyId = null;
        this.needsPasskeySetup = true;
        this.finishPasskeySetupStep();
      }
    });
  }

  private clearPasskeyRetryTimer(): void {
    if (this.passkeyRetryTimer !== null) {
      clearTimeout(this.passkeyRetryTimer);
      this.passkeyRetryTimer = null;
    }
  }

  private finishPasskeySetupStep(): void {
    if (this.needsPasskeySetup) {
      this.deviceName = this.getDeviceName();
    }
    this.step.set('passkey');
    this.loading = false;
  }

  async verifyPasskey(): Promise<void> {
    this.loading = true;
    this.clearMessages();

    try {
      await (this.authService as RemoteAuthService).unlockWithPasskey();
    } catch (err: unknown) {
      this.showPasskeyFailure(err);
      this.loading = false;
      return;
    }

    try {
      if (!this.isBrowserMode && !this.authService.getToken()) {
        throw new Error('No access token');
      }

      await this.attributeSessionToDevicePasskey();
      await this.syncCredentialsThenNavigate();
    } catch (err: any) {
      if (this.passkeyFromRefreshToken && (this.authService as RemoteAuthService).hasRefreshToken()) {
        // The device session is still valid, the server just could not be reached:
        // stay on the passkey step so a retry works without email + OTP.
        this.errorMessage = this.translate.instant('errors.network-error');
      } else if (this.passkeyFromRefreshToken) {
        this.passkeyFromRefreshToken = false;
        this.step.set('email');
        this.errorMessage = this.translate.instant('auth.errors.session-expired-request-code');
      } else {
        this.errorMessage = err?.message || 'Passkey verification failed';
      }
    } finally {
      this.loading = false;
    }
  }

  async createPasskeyForDevice(): Promise<void> {
    this.loading = true;
    this.clearMessages();

    let credentialId: string | null;
    try {
      await this.prfService.createPasskey(this.email() ||'Wallet User');
      credentialId = this.passkeyStore.getCredentialId();
    } catch (err: unknown) {
      this.showPasskeyFailure(err);
      this.loading = false;
      return;
    }

    if (!credentialId) {
      this.errorMessage = 'Failed to create passkey';
      this.loading = false;
      return;
    }

    try {
      if (!this.isBrowserMode && !this.authService.getToken()) {
        await (this.authService as RemoteAuthService).ensureAccessToken();
      }
      await firstValueFrom(this.passkeyApi.registerPasskey({
        credentialId,
        displayName: this.deviceName.trim() || this.getDeviceName(),
        userAgent: navigator.userAgent,
        refreshToken: localStorage.getItem('wallet_refresh_token')
      }));
      await this.syncCredentialsThenNavigate();
    } catch {
      // The WebAuthn credential was created locally but the server never learned
      // about it: roll back the local credential_id/has_passkey so the next
      // attempt starts clean instead of the device permanently believing it has
      // a passkey the account doesn't. The WebAuthn user handle (passkey-prf's
      // createPasskey) is kept, so the retry replaces the same resident
      // credential in the authenticator rather than creating another one.
      await this.passkeyStore.clearCredentialId();
      this.errorMessage = this.translate.instant('auth.errors.passkey-register-failed');
    } finally {
      this.loading = false;
    }
  }

  // --- Private helpers ---

  /** The current code can never succeed: clear it and drop the residual resend cooldown. */
  private discardCode(state: Exclude<CodeState, 'active'>): void {
    this.codeState.set(state);
    this.otpValue.set('');
    this.otpInput?.reset();
    this.resendAvailableAt.set(0);
  }

  private startResendCountdown(): void {
    this.resendAvailableAt.set(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
    this.startTicker();
  }

  /** Records a 429 for the current email; a later send 429 never lifts an active verify block. */
  private applyRateLimit(seconds: number, blocksVerify: boolean): void {
    const current = this.activeRateLimit();
    this.rateLimit.set({
      email: this.email().trim(),
      until: Math.max(Date.now() + seconds * 1000, current?.until ?? 0),
      blocksVerify: blocksVerify || (current?.blocksVerify ?? false),
    });
    this.startTicker();
  }

  private startTicker(): void {
    this.now.set(Date.now());
    if (this.ticker !== null || !this.hasPendingDeadline()) return;
    this.ticker = setInterval(() => {
      this.now.set(Date.now());
      if (!this.hasPendingDeadline()) {
        this.stopTicker();
      }
    }, 1000);
  }

  private stopTicker(): void {
    if (this.ticker !== null) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }

  // Any email's rate limit counts, so typing that email again shows a live countdown.
  private hasPendingDeadline(): boolean {
    const until = Math.max(this.resendAvailableAt(), this.rateLimit()?.until ?? 0);
    return until > this.now();
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.noticeMessage = '';
  }

  /**
   * Cancel/timeout of the OS passkey prompt is a normal user outcome: show a
   * neutral notice (the button stays enabled to retry) and do not log it as an
   * error. Anything else is a real fault: log it and show a translated message —
   * never the raw DOMException text, which is technical and English-only.
   */
  private showPasskeyFailure(err: unknown): void {
    if (err instanceof PasskeyError && err.isUserAbort) {
      // PasskeyError's cancel text is context-neutral; here we know it was a sign-in.
      const translationKey = err.code === 'passkey_cancelled' && err.ceremony === 'get'
        ? 'auth.errors.passkey-login-cancelled'
        : err.translationKey ?? 'auth.errors.passkey-failed';
      this.noticeMessage = this.translate.instant(translationKey);
      return;
    }

    console.error('[LoginPage] Passkey ceremony failed:', err);
    const translationKey = err instanceof PasskeyError && err.translationKey
      ? err.translationKey
      : 'auth.errors.passkey-failed';
    this.errorMessage = this.translate.instant(translationKey);
  }

  private async authenticateLocally(): Promise<void> {
    await this.prfService.assertLocalPasskey();
  }

  /**
   * Attributes this session's refresh token to the passkey that just verified it,
   * so the backend can revoke/rotate this device's tokens without touching the
   * account's other devices. Covers both entry points: the OTP flow (where
   * `resolvePasskeySetupStep` already resolved `matchedPasskeyId`) and the
   * different-day resume flow (`ionViewWillEnter` with a stored refresh token,
   * which never lists passkeys) — there we resolve this device's server passkey
   * from its local credential id here. Best-effort: never blocks a login that
   * already passed WebAuthn verification.
   */
  private async attributeSessionToDevicePasskey(): Promise<void> {
    const refreshToken = localStorage.getItem('wallet_refresh_token');
    if (!refreshToken) return;

    let passkeyId = this.matchedPasskeyId;
    if (!passkeyId) {
      const localCredentialId = this.prfService.getCredentialId();
      if (!localCredentialId) return;
      try {
        const passkeys = await firstValueFrom(this.passkeyApi.listPasskeys());
        passkeyId = passkeys.find(passkey => compareCredentialIds(passkey.credentialId, localCredentialId))?.id ?? null;
      } catch (err) {
        console.warn('[LoginPage] listPasskeys failed while attributing session', err);
        return;
      }
    }
    if (!passkeyId) return;

    try {
      await firstValueFrom(this.passkeyApi.confirmSession(passkeyId, refreshToken));
    } catch (err) {
      console.warn('[LoginPage] confirm-session failed, session stays unattributed', err);
    }
  }

  private navigateHome(): void {
    const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    void this.router.navigateByUrl(pendingLink || '/tabs/credentials');
  }

  private getDeviceName(): string {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android Device';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows PC';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown Device';
  }

  /**
   * Syncs credentials from the backend and then navigates. When the pending deep link
   * is a protocol link (VP / credential offer), we AWAIT the sync so IndexedDB holds the
   * server data before the credentials page runs the VP flow — this prevents a false
   * "no credentials available to login". For a normal login we don't block: the reactive
   * store updates on its own and the credentials tab reflects it as soon as it settles.
   */
  private async syncCredentialsThenNavigate(): Promise<void> {
    const pending = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    // Show the skeleton immediately while the sync runs.
    this.credentialCache.setLoading();

    if (this.isProtocolDeepLink(pending)) {
      try {
        await firstValueFrom(this.walletService.syncCredentials());
      } catch (err) {
        // If the server fetch fails, syncCredentials errors before
        // refreshCredentials() runs, so the store would stay 'loading' (stuck
        // skeleton). Force a terminal 'error' state so the credentials page /
        // VP flow can surface it instead of spinning forever.
        console.error('Credential sync failed', err);
        this.credentialCache.setError();
      }
    } else {
      this.syncCredentialCache();
    }

    // Fire regardless of which credential-sync path ran above (EUD-141 AC-01/AC-02).
    void this.activityService.syncFromServer();
    this.navigateHome();
  }

  private isProtocolDeepLink(url: string | null): boolean {
    if (!url) return false;
    return url.startsWith('/protocol/')
      || url.startsWith('/wallet/protocol/')
      || url.startsWith('/tabs/vc-selector')
      || url.startsWith('/wallet/tabs/vc-selector')
      || url.includes('authorizationRequest')
      || url.includes('credentialOfferUri')
      || url.includes('credential_offer_uri');
  }

  private syncCredentialCache(): void {
    this.walletService.syncCredentials().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      error: err => {
        // Same reasoning as syncCredentialsThenNavigate: force a terminal state
        // so the store never gets stuck in 'loading' on a failed server fetch.
        console.error('Sync failed', err);
        this.credentialCache.setError();
      }
    });
  }
}
