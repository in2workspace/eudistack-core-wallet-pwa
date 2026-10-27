import { Component, DestroyRef, ElementRef, OnDestroy, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyCeremonyService, PasskeySession, PrfCheckNeedsGestureError } from 'src/app/core/services/passkey-ceremony.service';
import { WebAuthnBrowserService } from 'src/app/core/services/webauthn-browser.service';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';
import { AUTH_PROBLEM_TYPE, authProblemType, WalletAuthError } from 'src/app/core/models/error/WalletAuthError';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { OtpInputComponent } from 'src/app/shared/components/otp-input/otp-input.component';
import { ThemeService } from 'src/app/core/services/theme.service';
import { WatermarkShape, watermarkStyle } from '../auth-watermark';

/** Screens of the access flow (EUD-8 `annex/wireframes.md`). `checking` is the passkey support check. */
export type AccessScreen =
  | 'checking'
  | 'requirements'
  | 'install'
  | 'access'
  | 'rejected'
  | 'unknown-passkey'
  | 'email'
  | 'code'
  | 'choose-passkey'
  | 'create-passkey'
  | 'passkey-incompatible'
  | 'check-passkey'
  | 'other-sessions';

const RESEND_COOLDOWN_SECONDS = 180;
const EMAIL_MAX_LENGTH = 254;
const DEVICE_NAME_MAX_LENGTH = 100;
const IOS_INSTALL_STEPS = ['step1', 'step2', 'step3', 'step4'] as const;
const MAC_INSTALL_STEPS = ['step-1', 'step-2', 'step-3'] as const;
const INSTALL_HELP_FAQS = [
  { question: 'auth.access.help.q1', answer: 'auth.access.help.a1' },
  { question: 'auth.access.help.q2', answer: 'auth.access.help.a2' },
  { question: 'auth.access.help.q3', answer: 'auth.access.help.a3' },
] as const;

/**
 * Whether the code the user holds can still be checked: `expired` (401
 * `expired_code`) and `exhausted` (429 `too_many_attempts`) both need a new code.
 */
type CodeState = 'active' | 'expired' | 'exhausted';

/**
 * A 429 + Retry-After from the service: until `until` no new code can be sent
 * to `email` and, when it came from verify-email, no code can be checked either.
 */
interface RateLimit {
  email: string;
  until: number;
  blocksVerify: boolean;
}

const sameEmail = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * `local@domain.tld`: no white space, a single `@` with text before it, and a
 * dot in the domain with text on both sides. The service validates the address.
 */
export function hasEmailFormat(email: string): boolean {
  if (/\s/.test(email)) return false;
  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.', 1);
  return dot > 0 && dot < domain.length - 1;
}

/**
 * Single access screen of the wallet in server mode (EUD-8): sign-in with a
 * passkey from the system picker, and the email flow (email → code → choose or
 * create a passkey) for the first registration and recovery.
 *
 * Every session is opened by the Wallet Unit Service after it verifies a
 * passkey. A cancelled picker or dialog keeps the user on the same screen with
 * no message (FR-07, FR-12).
 */
@Component({
  selector: 'app-access',
  templateUrl: './access.page.html',
  styleUrls: ['../login/login.page.scss', './access.page.scss'],
  imports: [FormsModule, IonicModule, OtpInputComponent, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AccessPage implements OnDestroy {
  @ViewChild('otpRef') private readonly otpInput?: OtpInputComponent;
  @ViewChild('heading') private readonly heading?: ElementRef<HTMLElement>;

  private readonly authService = inject(RemoteAuthService);
  private readonly ceremony = inject(PasskeyCeremonyService);
  private readonly webAuthnBrowser = inject(WebAuthnBrowserService);
  private readonly supportChannel = inject(SupportChannelService);
  private readonly pwaInstall = inject(PwaInstallService);
  private readonly iosInstall = inject(IosInstallService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly installable = toSignal(this.pwaInstall.installable$, { initialValue: false });
  private readonly theme = toSignal(inject(ThemeService).getTheme());

  readonly screen = signal<AccessScreen>('checking');
  readonly busy = signal(false);
  readonly errorMessage = signal('');
  readonly sessionExpired = signal(false);
  readonly email = signal('');
  readonly otpValue = signal('');
  readonly codeState = signal<CodeState>('active');
  readonly deviceName = signal(defaultDeviceName());
  readonly showIosSteps = signal(false);
  readonly showMacSteps = signal(false);
  readonly showInstallHelp = signal(false);
  /** Whether the account of the email flow already had passkeys (verify-email). */
  readonly accountHadPasskeys = signal(false);

  readonly iosInstallSteps = IOS_INSTALL_STEPS;
  readonly macInstallSteps = MAC_INSTALL_STEPS;
  readonly installHelpFaqs = INSTALL_HELP_FAQS;
  readonly emailMaxLength = EMAIL_MAX_LENGTH;
  readonly deviceNameMaxLength = DEVICE_NAME_MAX_LENGTH;

  /** Screen the "Retry" of a rejected sign-in goes back to. */
  private rejectedFrom: 'access' | 'choose-passkey' = 'access';
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Registration waiting for a tap to run its PRF check (Safari, see checkCreatedPasskey). */
  private pendingPrfCheck: (() => Promise<PasskeySession>) | null = null;
  /** A logout the service has not confirmed yet (offline): the access screen says so. */
  readonly serverLogoutPending = this.authService.serverLogoutPending;
  private readonly resendAvailableAt = signal(0);
  private readonly rateLimit = signal<RateLimit | null>(null);
  private readonly now = signal(Date.now());
  private ticker: ReturnType<typeof setInterval> | null = null;
  private rateLimitMessage: string | null = null;

  /** Tenant wallet name, as the browser-mode LoginPage shows it. */
  readonly brandName = computed(() => {
    const name = this.theme()?.branding?.name?.trim();
    return name ? name.split(' ')[0] : 'Wallet';
  });

  /** Same artwork per step as the browser-mode LoginPage. */
  readonly watermark = computed<WatermarkShape | null>(() => {
    switch (this.screen()) {
      case 'checking': return null;
      case 'install': return 'access';
      case 'email': return 'email';
      case 'code': return 'verify';
      default: return 'passkey';
    }
  });

  readonly watermarkStyle = computed(() => watermarkStyle(this.watermark()));

  /** Screens with the top-left back button (see goBack). */
  readonly canGoBack = computed(() =>
    ['email', 'code', 'unknown-passkey', 'choose-passkey', 'create-passkey'].includes(this.screen()));

  readonly emailIsValid = computed(() => {
    const email = this.email().trim();
    return email.length <= EMAIL_MAX_LENGTH && hasEmailFormat(email);
  });

  /** FR-02: only in a tab that can be installed. iOS cannot launch the install, so it shows the steps. */
  readonly installSuggestion = computed<'prompt' | 'ios' | 'mac' | null>(() => {
    if (this.pwaInstall.isStandalone) return null;
    if (this.installable()) return 'prompt';
    if (this.iosInstall.isIosSafariBrowserMode()) return 'ios';
    if (this.pwaInstall.isMacSafari) return 'mac';
    return null;
  });

  /** Passkey custody (FR-09): a new passkey cannot open the attestations obtained with another one. */
  readonly showAttestationsWarning = computed(() => this.accountHadPasskeys() && this.ceremony.hasPasskeyCustody());

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

  readonly canSendCode = computed(() => this.emailIsValid() && !this.busy() && this.resendSecondsLeft() === 0);

  readonly canSubmitCode = computed(() =>
    this.otpValue().length === 6 && this.codeState() === 'active' && !this.verifyRateLimited());

  readonly resendCountdown = computed(() => {
    const total = this.resendSecondsLeft();
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = (value: number) => String(value).padStart(2, '0');
    return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  });

  ionViewWillEnter(): void {
    // A ticket from an earlier visit must not leak into this one (it is in memory only).
    this.authService.leaveEmailFlow();
    this.accountHadPasskeys.set(false);
    this.pendingPrfCheck = null;
    this.busy.set(false);
    this.errorMessage.set('');
    this.showIosSteps.set(false);
    this.showMacSteps.set(false);
    this.showInstallHelp.set(false);
    this.sessionExpired.set(this.authService.consumeSessionExpiredNotice());
    this.startTicker();
    this.screen.set('checking');
    // FR-01: nothing is created before the browser is known to handle passkeys.
    void Promise.all([
      this.webAuthnBrowser.isPasskeySupported(),
      firstValueFrom(this.pwaInstall.installDecision$),
    ]).then(([supported, installable]) => {
      if (!supported) {
        this.goTo('requirements');
      } else {
        this.goTo(this.showsInstallScreen(installable) ? 'install' : 'access');
      }
    });
  }

  /**
   * FR-02: the install screen of the browser-mode LoginPage comes first in a tab
   * that can be installed, and on iOS Safari, which can only show the steps. It
   * is skipped when the user was already in (expired session, pending logout).
   */
  private showsInstallScreen(installable: boolean): boolean {
    if (this.pwaInstall.isStandalone || this.sessionExpired() || this.serverLogoutPending()) return false;
    return installable || this.iosInstall.isIosSafariBrowserMode();
  }

  ionViewWillLeave(): void {
    this.stopTicker();
    this.clearFocusTimer();
  }

  ngOnDestroy(): void {
    this.stopTicker();
    this.clearFocusTimer();
  }

  // --- Acceso ---

  async signInWithPasskey(): Promise<void> {
    await this.signIn('access');
  }

  startEmailFlow(): void {
    this.sessionExpired.set(false);
    this.goTo('email');
  }

  backToAccess(): void {
    this.pendingPrfCheck = null;
    this.authService.leaveEmailFlow();
    this.accountHadPasskeys.set(false);
    this.goTo('access');
  }

  /**
   * Top-left back button. Code goes back to Email; Elegir passkey too, and Crear
   * passkey to Elegir passkey when the account had passkeys. Leaving the
   * verified email forgets its ticket. Email and Passkey desconocida go to Acceso.
   */
  goBack(): void {
    switch (this.screen()) {
      case 'code':
        this.changeEmail();
        return;
      case 'create-passkey':
        if (this.accountHadPasskeys()) {
          this.goTo('choose-passkey');
          return;
        }
        this.leaveVerifiedEmail();
        return;
      case 'choose-passkey':
        this.leaveVerifiedEmail();
        return;
      default:
        this.backToAccess();
    }
  }

  private leaveVerifiedEmail(): void {
    this.pendingPrfCheck = null;
    this.authService.leaveEmailFlow();
    this.accountHadPasskeys.set(false);
    this.changeEmail();
  }

  retryAfterRejection(): void {
    this.goTo(this.rejectedFrom);
  }

  openHelp(): void {
    const channels = this.supportChannel.channels();
    window.open(channels.helpCenterUrl ?? channels.supportUrl, '_blank', 'noopener');
  }

  /** "Continue in browser" on the install screen. */
  continueInBrowser(): void {
    this.goTo('access');
  }

  async install(): Promise<void> {
    switch (this.installSuggestion()) {
      case 'prompt':
        await this.pwaInstall.promptInstall();
        this.goTo('access');
        return;
      case 'ios':
        this.showIosSteps.set(true);
        return;
      case 'mac':
        this.showMacSteps.set(true);
        return;
      default:
        return;
    }
  }

  // --- Email ---

  sendCode(): void {
    if (!this.canSendCode()) return;
    this.requestCode(() => this.goTo('code'));
  }

  resendCode(): void {
    if (this.busy() || this.resendSecondsLeft() > 0) return;
    this.requestCode(() => this.otpInput?.reset());
  }

  changeEmail(): void {
    this.otpValue.set('');
    this.codeState.set('active');
    this.resendAvailableAt.set(0);
    this.goTo('email');
  }

  // --- Code ---

  onOtpChanged(code: string): void {
    this.otpValue.set(code);
    if (this.codeState() === 'active' && !this.verifyRateLimited()) {
      this.errorMessage.set('');
    }
  }

  onOtpCompleted(code: string): void {
    this.otpValue.set(code);
    this.verifyCode();
  }

  verifyCode(): void {
    if (!this.canSubmitCode() || this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');

    this.authService.verifyEmailCode(this.email().trim(), this.otpValue()).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: ({ hasPasskeys }) => {
        this.busy.set(false);
        this.resendAvailableAt.set(0);
        this.rateLimit.set(null);
        this.accountHadPasskeys.set(hasPasskeys);
        this.goTo(hasPasskeys ? 'choose-passkey' : 'create-passkey');
      },
      error: (err: unknown) => this.handleVerifyCodeError(err),
    });
  }

  // --- Elegir passkey ---

  async useAccountPasskey(): Promise<void> {
    await this.signIn('choose-passkey');
  }

  createNewPasskey(): void {
    this.goTo('create-passkey');
  }

  // --- Crear passkey ---

  async createPasskey(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    try {
      await this.authService.registerPasskey(this.deviceName());
      await this.afterRegistration();
    } catch (err: unknown) {
      this.handleRegistrationError(err);
    } finally {
      this.busy.set(false);
    }
  }

  retryWithOtherAuthenticator(): void {
    this.goTo('create-passkey');
  }

  /**
   * Runs the PRF check of the passkey just created from this tap: Safari only
   * lets a WebAuthn call start from a fresh user gesture, so it could not run
   * right after the creation dialog. Must stay the first thing the click does.
   */
  async checkCreatedPasskey(): Promise<void> {
    const resume = this.pendingPrfCheck;
    if (!resume || this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    try {
      await this.authService.completeRegistration(resume);
      this.pendingPrfCheck = null;
      await this.afterRegistration();
    } catch (err: unknown) {
      this.pendingPrfCheck = null;
      if (err instanceof PasskeyError && err.isUserAbort) {
        this.goTo('create-passkey');
        return;
      }
      this.handleRegistrationError(err);
    } finally {
      this.busy.set(false);
    }
  }

  // --- Otras sesiones ---

  closeOtherSessions(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    this.authService.endOtherSessions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.busy.set(false);
        void this.enterWallet();
      },
      error: () => {
        this.busy.set(false);
        this.errorMessage.set(this.translate.instant('wallet-access.other-sessions.failed'));
      },
    });
  }

  keepOtherSessions(): void {
    void this.enterWallet();
  }

  // --- Private helpers ---

  private async signIn(origin: 'access' | 'choose-passkey'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorMessage.set('');
    try {
      await this.authService.signInWithPasskey();
      await this.enterWallet();
    } catch (err: unknown) {
      this.handleSignInError(err, origin);
    } finally {
      this.busy.set(false);
    }
  }

  private handleSignInError(err: unknown, origin: 'access' | 'choose-passkey'): void {
    if (err instanceof PasskeyError && err.isUserAbort) {
      return;
    }
    if (err instanceof WalletAuthError) {
      switch (err.failure) {
        case 'unknown_credential':
          this.goTo('unknown-passkey');
          return;
        case 'authentication_failed':
          this.rejectedFrom = origin;
          this.goTo('rejected');
          return;
        case 'invalid_ticket':
          this.restartEmailFlow();
          return;
        default:
          break;
      }
    }
    this.showFailure(err);
  }

  private async afterRegistration(): Promise<void> {
    if (this.accountHadPasskeys()) {
      this.goTo('other-sessions');
    } else {
      await this.enterWallet();
    }
  }

  private handleRegistrationError(err: unknown): void {
    if (err instanceof PrfCheckNeedsGestureError) {
      this.pendingPrfCheck = err.resume;
      this.goTo('check-passkey');
      return;
    }
    if (err instanceof PasskeyError && err.isUserAbort) {
      return;
    }
    if (err instanceof WalletAuthError) {
      switch (err.failure) {
        case 'passkey_prf_unsupported':
          this.goTo('passkey-incompatible');
          return;
        case 'invalid_ticket':
          this.restartEmailFlow();
          return;
        case 'registration_failed':
          this.errorMessage.set(this.translate.instant('wallet-access.errors.registration-failed'));
          return;
        default:
          break;
      }
    }
    this.showFailure(err);
  }

  /** The registration ticket has expired or was used: the email has to be verified again. */
  private restartEmailFlow(): void {
    this.authService.leaveEmailFlow();
    this.otpValue.set('');
    this.codeState.set('active');
    this.goTo('email');
    this.errorMessage.set(this.translate.instant('wallet-access.errors.ticket-expired'));
  }

  private showFailure(err: unknown): void {
    if (err instanceof PasskeyError) {
      console.error('[AccessPage] Passkey ceremony failed:', err);
      this.errorMessage.set(this.translate.instant(err.translationKey ?? 'auth.errors.passkey-failed'));
      return;
    }
    if (err instanceof HttpErrorResponse && err.status === 429) {
      this.errorMessage.set(this.translate.instant('auth.errors.too-many-attempts'));
      return;
    }
    console.error('[AccessPage] Access failed:', err);
    const offline = err instanceof HttpErrorResponse && err.status === 0;
    this.errorMessage.set(this.translate.instant(offline ? 'errors.network-error' : 'wallet-access.errors.generic'));
  }

  private requestCode(onSent: () => void): void {
    this.busy.set(true);
    this.errorMessage.set('');
    this.authService.requestEmailCode(this.email().trim()).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.busy.set(false);
        this.otpValue.set('');
        this.codeState.set('active');
        this.resendAvailableAt.set(Date.now() + RESEND_COOLDOWN_SECONDS * 1000);
        this.startTicker();
        onSent();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (err instanceof HttpErrorResponse && err.status === 429) {
          // FR-06: the same message whether the email has an account or not.
          this.applyRateLimit(retryAfterSeconds(err), false);
          this.showRateLimitMessage('wallet-access.email.rate-limited');
        } else {
          this.showFailure(err);
        }
      },
    });
  }

  private handleVerifyCodeError(err: unknown): void {
    this.busy.set(false);
    const type = authProblemType(err);
    const status = err instanceof HttpErrorResponse ? err.status : undefined;
    if (type === AUTH_PROBLEM_TYPE.EXPIRED_CODE) {
      this.discardCode('expired');
      this.errorMessage.set(this.translate.instant('auth.errors.otp-expired'));
    } else if (type === AUTH_PROBLEM_TYPE.TOO_MANY_ATTEMPTS) {
      this.discardCode('exhausted');
      this.errorMessage.set(this.translate.instant('auth.errors.too-many-attempts-otp'));
    } else if (status === 429) {
      this.applyRateLimit(retryAfterSeconds(err as HttpErrorResponse), true);
      this.showRateLimitMessage('auth.errors.too-many-attempts-wait');
    } else if (type === AUTH_PROBLEM_TYPE.INVALID_CODE) {
      this.errorMessage.set(this.translate.instant('auth.errors.otp-invalid'));
    } else {
      this.showFailure(err);
    }
  }

  private discardCode(state: Exclude<CodeState, 'active'>): void {
    this.codeState.set(state);
    this.otpValue.set('');
    this.otpInput?.reset();
    this.resendAvailableAt.set(0);
  }

  private applyRateLimit(seconds: number, blocksVerify: boolean): void {
    const current = this.activeRateLimit();
    this.rateLimit.set({
      email: this.email().trim(),
      until: Math.max(Date.now() + seconds * 1000, current?.until ?? 0),
      blocksVerify: blocksVerify || (current?.blocksVerify ?? false),
    });
    this.startTicker();
  }

  private showRateLimitMessage(key: string): void {
    const message = this.translate.instant(key);
    this.errorMessage.set(message);
    this.rateLimitMessage = message;
  }

  private startTicker(): void {
    this.now.set(Date.now());
    if (this.ticker !== null || !this.hasPendingDeadline()) return;
    this.ticker = setInterval(() => {
      this.now.set(Date.now());
      this.clearExpiredRateLimitMessage();
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

  private hasPendingDeadline(): boolean {
    const until = Math.max(this.resendAvailableAt(), this.rateLimit()?.until ?? 0);
    return until > this.now();
  }

  private clearExpiredRateLimitMessage(): void {
    const rateLimit = this.rateLimit();
    if (this.rateLimitMessage === null || (rateLimit !== null && this.now() < rateLimit.until)) return;
    if (this.errorMessage() === this.rateLimitMessage) {
      this.errorMessage.set('');
    }
    this.rateLimitMessage = null;
  }

  /** Moves to a screen and puts the focus on its heading, so screen readers announce it (WCAG 2.4.3). */
  private goTo(screen: AccessScreen): void {
    this.errorMessage.set('');
    this.screen.set(screen);
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      this.heading?.nativeElement.focus();
    });
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  /**
   * Opens the wallet. A pending protocol link (presentation request, credential
   * offer) waits for the session's attestations to be in the local store, so the
   * flow never reads an empty or stale list.
   */
  private async enterWallet(): Promise<void> {
    if (isProtocolDeepLink(sessionStorage.getItem(PENDING_DEEP_LINK_KEY))) {
      await this.authService.sessionDataReady();
    }
    await this.router.navigateByUrl(takePendingDeepLink() || '/tabs/credentials');
  }
}

function retryAfterSeconds(err: HttpErrorResponse): number {
  const seconds = Number(err.headers?.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : RESEND_COOLDOWN_SECONDS;
}

function isProtocolDeepLink(url: string | null): boolean {
  if (!url) return false;
  return url.startsWith('/protocol/')
    || url.startsWith('/wallet/protocol/')
    || url.startsWith('/tabs/vc-selector')
    || url.startsWith('/wallet/tabs/vc-selector')
    || url.includes('authorizationRequest')
    || url.includes('credentialOfferUri')
    || url.includes('credential_offer_uri');
}

/** Default name of the new passkey; the user can change it and the service sets one if empty. */
function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux';
  return '';
}
