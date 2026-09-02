import { Component, OnDestroy, computed, inject, signal, ViewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { PasskeyApiService } from 'src/app/core/services/passkey-api.service';
import { base64UrlDecode } from 'src/app/core/utils/base64url';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { OtpInputComponent } from 'src/app/shared/components/otp-input/otp-input.component';
import { WalletService } from 'src/app/core/services/wallet.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';

const RESEND_COOLDOWN_SECONDS = 180;

type WatermarkShape = 'access' | 'email' | 'verify' | 'passkey';

const WATERMARK_ASSETS: Record<WatermarkShape, string> = {
  access: 'assets/svg/download-solid.svg',
  email: 'assets/svg/user-solid.svg',
  verify: 'assets/svg/envelope-circle-check-solid.svg',
  passkey: 'assets/svg/door-open-solid.svg',
};

const WATERMARK_VIEWBOX_WIDTH = 672;

const WATERMARK_CROP_TOP = 200;

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
  readonly showInstallScreen = signal(!this.pwaInstall.isStandalone);
  showHelpModal = false;

  readonly helpFaqs = [
    { question: 'auth.access.help.q1', answer: 'auth.access.help.a1' },
    { question: 'auth.access.help.q2', answer: 'auth.access.help.a2' },
    { question: 'auth.access.help.q3', answer: 'auth.access.help.a3' },
  ];

  // Server mode: multi-step flow
  email = '';
  otpValue = '';
  readonly step = signal<'email' | 'code' | 'passkey'>('email');
  needsPasskeySetup = false;
  deviceName = '';
  readonly resendSecondsLeft = signal(0);
  private resendTimer: ReturnType<typeof setInterval> | null = null;
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

  readonly isBrowserMode = this.authService instanceof LocalAuthService;
  readonly hasExistingPasskey = this.prfService.hasPasskey();

  readonly brandName = computed(() => {
    const name = this.theme()?.branding?.name?.trim();
    return name ? name.split(' ')[0] : 'Wallet';
  });

  readonly screen = computed<'checking' | 'access' | 'browser' | 'email' | 'code' | 'passkey'>(() => {
    const decision = this.installDecision();
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

  readonly resendCountdown = computed(() => {
    const total = this.resendSecondsLeft();
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  });

  ionViewWillEnter(): void {
    this.loading = false;
    this.errorMessage = '';

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
    this.stopResendCountdown();
  }

  ngOnDestroy(): void {
    this.stopResendCountdown();
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

  // --- Browser mode: single-step passkey login ---

  async loginBrowserMode(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      await this.authenticateLocally();
      (this.authService as LocalAuthService).markAuthenticated();
      this.navigateHome();
    } catch (err: any) {
      this.errorMessage = err?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }

  // --- Browser mode: passkey creation (register) ---

  async createWalletBrowserMode(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';
    try {
      await (this.authService as LocalAuthService).setupPasskey();
      this.navigateHome();
    } catch (err: any) {
      this.errorMessage = err?.message || 'Failed to create passkey';
    } finally {
      this.loading = false;
    }
  }

  // --- Server mode: email + OTP + passkey flow ---

  onOtpCompleted(code: string): void {
    if (!this.loading) {
      this.otpValue = code;
      this.verifyCode();
    }
  }

  goBackToEmail(): void {
    this.step.set('email');
    this.errorMessage = '';
    this.otpValue = '';
    this.stopResendCountdown();
  }

  sendCode(): void {
    if (!this.email || this.loading) return;

    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).register(this.email, 'login').subscribe({
      next: () => {
        this.step.set('code');
        this.otpValue = '';
        this.loading = false;
        this.startResendCountdown();
      },
      error: (err) => {
        this.errorMessage = err?.status === 429
          ? this.translate.instant('auth.errors.too-many-attempts')
          : (err?.error?.message || err?.error?.detail || 'Failed to send verification code');
        this.loading = false;
      }
    });
  }

  resendCode(): void {
    if (this.loading || this.resendSecondsLeft() > 0) return;

    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).register(this.email, 'login').subscribe({
      next: () => {
        this.otpValue = '';
        this.loading = false;
        this.startResendCountdown();
      },
      error: (err) => {
        this.errorMessage = err?.status === 429
          ? this.translate.instant('auth.errors.too-many-attempts')
          : (err?.error?.message || err?.error?.detail || 'Failed to send verification code');
        this.loading = false;
      }
    });
  }

  verifyCode(): void {
    if (this.otpValue.length < 6 || this.loading) return;

    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).verifyEmail(this.email, this.otpValue).subscribe({
      next: () => {
        this.loading = false;
        this.stopResendCountdown();
        this.passkeyFromRefreshToken = false;
        this.needsPasskeySetup = !this.prfService.hasPasskey();
        if (this.needsPasskeySetup) {
          this.deviceName = this.getDeviceName();
        }
        this.step.set('passkey');
      },
      error: (err) => {
        this.errorMessage = err?.status === 429
          ? this.translate.instant('auth.errors.too-many-attempts-otp')
          : (err?.error?.message || err?.error?.detail || 'Invalid verification code');
        this.loading = false;
      }
    });
  }

  async verifyPasskey(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      await this.authenticateLocally();

      if (this.passkeyFromRefreshToken) {
        await firstValueFrom((this.authService as RemoteAuthService).refreshAccessToken());
      }

      await this.syncCredentialsThenNavigate();
    } catch (err: any) {
      if (this.passkeyFromRefreshToken) {
        localStorage.removeItem('wallet_refresh_token');
        this.passkeyFromRefreshToken = false;
        this.step.set('email');
        this.errorMessage = 'Your session has expired. Please sign in again.';
      } else {
        this.errorMessage = err?.message || 'Passkey verification failed';
      }
      this.loading = false;
    }
  }

  async createPasskeyForDevice(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    let credentialId: string | null;
    try {
      await this.prfService.createPasskey(this.email || 'Wallet User');
      credentialId = this.passkeyStore.getCredentialId();
    } catch (err: any) {
      this.errorMessage = err?.message || 'Failed to create passkey';
      this.loading = false;
      return;
    }

    if (!credentialId) {
      this.errorMessage = 'Failed to create passkey';
      this.loading = false;
      return;
    }

    try {
      await firstValueFrom(this.passkeyApi.registerPasskey({
        credentialId,
        displayName: this.deviceName.trim() || this.getDeviceName(),
        userAgent: navigator.userAgent
      }));
      await this.syncCredentialsThenNavigate();
    } catch {
      this.errorMessage = this.translate.instant('auth.errors.passkey-register-failed');
    } finally {
      this.loading = false;
    }
  }

  // --- Private helpers ---

  private startResendCountdown(): void {
    this.stopResendCountdown();
    this.resendSecondsLeft.set(RESEND_COOLDOWN_SECONDS);
    this.resendTimer = setInterval(() => {
      this.resendSecondsLeft.update(seconds => seconds - 1);
      if (this.resendSecondsLeft() <= 0) {
        this.stopResendCountdown();
      }
    }, 1000);
  }

  private stopResendCountdown(): void {
    if (this.resendTimer !== null) {
      clearInterval(this.resendTimer);
      this.resendTimer = null;
    }
    this.resendSecondsLeft.set(0);
  }

  private async authenticateLocally(): Promise<void> {
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
      },
    });

    if (!assertion) {
      throw new Error('Authentication cancelled');
    }
  }

  private navigateHome(): void {
    const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    this.router.navigateByUrl(pendingLink || '/tabs/credentials');
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
    this.activityService.syncFromServer();
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
    this.walletService.syncCredentials().subscribe({
      error: err => {
        // Same reasoning as syncCredentialsThenNavigate: force a terminal state
        // so the store never gets stuck in 'loading' on a failed server fetch.
        console.error('Sync failed', err);
        this.credentialCache.setError();
      }
    });
  }
}