import { Component, DestroyRef, OnDestroy, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { take } from 'rxjs';
import { AuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';

// Reassures the user that initialization is still progressing.
const INIT_SLOW_THRESHOLD_MS = 3000;
// Above PwaInstallService's own hard ceiling (INSTALL_DECISION_HARD_TIMEOUT_MS):
// a safety net in case something other than installDecision$ hangs.
const INIT_FAIL_THRESHOLD_MS = 8000;

type WatermarkShape = 'access' | 'passkey';

const WATERMARK_ASSETS: Record<WatermarkShape, string> = {
  access: 'assets/svg/download-solid.svg',
  passkey: 'assets/svg/door-open-solid.svg',
};

const WATERMARK_VIEWBOX_WIDTH = 672;

const WATERMARK_CROP_TOP = 200;

/**
 * Access screen of browser mode (local passkey, no Wallet Unit Service). Server
 * mode uses AccessPage (`/auth/access`); `/auth/login` and `/auth/register`
 * redirect there in server mode.
 */
@Component({
    selector: 'app-login',
    templateUrl: './login.page.html',
    styleUrl: './login.page.scss',
  imports: [CommonModule, IonicModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage implements OnDestroy {
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

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly destroyRef = inject(DestroyRef);

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

  readonly screen = computed<'checking' | 'access' | 'browser'>(() => {
    const decision = this.forceReady() ? false : this.installDecision();
    if (decision === undefined) return 'checking';
    if (decision && this.showInstallScreen()) return 'access';
    return 'browser';
  });

  readonly watermark = computed<WatermarkShape | null>(() => {
    switch (this.screen()) {
      case 'checking': return null;
      case 'access': return 'access';
      default: return 'passkey';
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

  ionViewWillEnter(): void {
    this.loading = false;
    this.clearMessages();
    this.forceReady.set(false);
    this.startInitWatchdog();
  }

  ionViewWillLeave(): void {
    this.teardownTimers();
  }

  ngOnDestroy(): void {
    this.teardownTimers();
  }

  /** Cancels the init watchdog timers this page owns. */
  private teardownTimers(): void {
    this.clearInitWatchdog();
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

  private navigateHome(): void {
    void this.router.navigateByUrl(takePendingDeepLink() || '/tabs/credentials');
  }
}
