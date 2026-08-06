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

@Component({
    selector: 'app-login',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-page">
        <div class="auth-wrapper">
          @if (canGoBack()) {
            <button type="button" class="auth-back" (click)="goBackToEmail()">
              <ion-icon name="chevron-back-outline"></ion-icon>
              {{ 'auth.register.back' | translate }}
            </button>
          }

          <!-- Shape comes from /assets/svg via CSS mask -->
          <div class="auth-watermark" [attr.data-shape]="watermark()" aria-hidden="true"></div>

          <div class="auth-content">
            @switch (screen()) {

              <!-- Installability probe still running -->
              @case ('checking') {
                <div class="auth-checking">
                  <ion-spinner name="crescent"></ion-spinner>
                </div>
              }

              <!-- Step 1: Access -->
              @case ('access') {
                <h1 class="auth-title">{{ 'auth.access.title' | translate: { brand: brandName() } }}</h1>

                <p class="auth-subtitle">{{ 'auth.access.install-hint' | translate }}</p>
                <p class="auth-subtitle">{{ 'auth.access.open-hint' | translate: { brand: brandName() } }}</p>

                <button type="button" class="auth-link-button" (click)="skipInstall()">
                  {{ 'auth.register.continue-browser' | translate }}
                </button>

                <button type="button" class="auth-button" (click)="installApp()">
                  {{ 'auth.access.continue-wallet' | translate: { brand: brandName() } }}
                </button>

                <aside class="auth-notice">
                  <p class="auth-notice__title">{{ 'auth.access.already-title' | translate: { brand: brandName() } }}</p>
                  <p class="auth-notice__text">{{ 'auth.access.already-text' | translate }}</p>
                  <button type="button" class="auth-notice__link" (click)="openHelp()">
                    {{ 'auth.access.help-link' | translate }}
                  </button>
                </aside>
              }

              <!-- Browser mode: single-step passkey -->
              @case ('browser') {
                <h1 class="auth-title">
                  {{ (hasExistingPasskey ? 'auth.login.title-welcome' : 'auth.login.title') | translate }}
                </h1>
                <p class="auth-subtitle">
                  {{ (hasExistingPasskey ? 'auth.login.subtitle' : 'auth.login.create-passkey-subtitle') | translate }}
                </p>

                @if (hasExistingPasskey) {
                  <button type="button" class="auth-button" (click)="loginBrowserMode()" [disabled]="loading">
                    {{ 'auth.login.passkey-button' | translate }}
                  </button>
                } @else {
                  <button type="button" class="auth-button" (click)="createWalletBrowserMode()" [disabled]="loading">
                    {{ 'auth.passkey.register-button' | translate }}
                  </button>
                }
              }

              <!-- Step 2: Email -->
              @case ('email') {
                <h1 class="auth-title">{{ 'auth.login.email-title' | translate }}</h1>
                <p class="auth-subtitle">{{ 'auth.login.email-subtitle' | translate: { brand: brandName() } }}</p>

                <div class="auth-field">
                  <label class="auth-field__label" for="login-email">
                    {{ 'auth.register.email-label' | translate }}
                  </label>
                  <ion-input
                    id="login-email"
                    [(ngModel)]="email"
                    type="email"
                    inputmode="email"
                    autocomplete="email"
                    [placeholder]="'auth.register.email-placeholder' | translate"
                    class="auth-input"
                    (keyup.enter)="email && !loading && sendCode()"
                  ></ion-input>
                </div>

                <button
                  type="button"
                  class="auth-button"
                  [disabled]="!email || loading"
                  (click)="sendCode()"
                >
                  <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                  <span *ngIf="!loading">{{ 'auth.register.send-code' | translate }}</span>
                </button>
              }

              <!-- Step 3: Verify email -->
              @case ('code') {
                <h1 class="auth-title">{{ 'auth.register.verify-title' | translate }}</h1>
                <p class="auth-subtitle">
                  {{ 'auth.register.code-sent-prefix' | translate }} <strong>{{ email }}</strong>.<br />
                  {{ 'auth.register.code-validity' | translate }}
                </p>

                <div class="auth-field auth-field--otp">
                  <span class="auth-field__label">{{ 'auth.register.code-label' | translate }}</span>
                  <app-otp-input
                    #otpRef
                    [length]="6"
                    [autofocus]="true"
                    [error]="!!errorMessage"
                    [errorMessage]="errorMessage"
                    (changed)="otpValue = $event; errorMessage = ''"
                  ></app-otp-input>
                </div>

                <p class="auth-resend">
                  @if (resendSecondsLeft() > 0) {
                    {{ 'auth.register.resend-in' | translate: { time: resendCountdown() } }}
                  } @else {
                    {{ 'auth.register.resend-prompt' | translate }}
                    <button type="button" class="auth-inline-link" [disabled]="loading" (click)="resendCode()">
                      {{ 'auth.register.resend-action' | translate }}
                    </button>
                  }
                </p>

                <button
                  type="button"
                  class="auth-button"
                  [disabled]="otpValue.length < 6 || loading"
                  (click)="verifyCode()"
                >
                  <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                  <span *ngIf="!loading">{{ 'auth.register.continue' | translate }}</span>
                </button>
              }

              <!-- Step 4: Passkey -->
              @case ('passkey') {
                @if (needsPasskeySetup) {
                  <h1 class="auth-title">
                    {{ 'auth.passkey.verified-title' | translate }}<br />
                    {{ 'auth.passkey.setup-title' | translate }}
                  </h1>
                  <p class="auth-subtitle">
                    {{ 'auth.passkey.verified-subtitle' | translate }}<br />
                    {{ 'auth.passkey.setup-subtitle' | translate }}
                  </p>

                  <button type="button" class="auth-button" [disabled]="loading" (click)="createPasskeyForDevice()">
                    {{ 'auth.passkey.register-button' | translate }}
                  </button>
                } @else {
                  <h1 class="auth-title">{{ 'auth.login.title-welcome' | translate }}</h1>
                  <p class="auth-subtitle">{{ 'auth.login.verify-passkey' | translate }}</p>

                  <button type="button" class="auth-button" [disabled]="loading" (click)="verifyPasskey()">
                    {{ 'auth.login.passkey-button' | translate }}
                  </button>
                }
              }
            }

            @if (errorMessage) {
              <div class="error-box">
                <ion-icon name="alert-circle-outline"></ion-icon>
                <span>{{ errorMessage }}</span>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- Blocking overlay while the passkey runs -->
      @if (loading && step() === 'passkey') {
        <div class="auth-overlay">
          <ion-spinner name="crescent"></ion-spinner>
        </div>
      }

      <!-- "Need help?" modal-->
      <ion-modal class="auth-help-modal" [isOpen]="showHelpModal" (didDismiss)="closeHelp()">
        <ng-template>
          <div class="help-modal">
            <button type="button" class="help-modal__close" (click)="closeHelp()" [attr.aria-label]="'auth.access.help.close' | translate">
              <ion-icon name="close-outline"></ion-icon>
            </button>

            <h2 class="help-modal__title">{{ 'auth.access.help.title' | translate }}</h2>
            <p class="help-modal__intro">{{ 'auth.access.help.intro' | translate }}</p>

            @for (faq of helpFaqs; track faq.question) {
              <div class="help-modal__item">
                <p class="help-modal__question">{{ faq.question | translate: { brand: brandName() } }}</p>
                <p class="help-modal__answer">{{ faq.answer | translate: { brand: brandName() } }}</p>
              </div>
            }

            <button type="button" class="auth-button" (click)="closeHelp()">
              {{ 'auth.access.help.close' | translate }}
            </button>
          </div>
        </ng-template>
      </ion-modal>
    </ion-content>
  `,
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

  readonly watermark = computed<'access' | 'email' | 'verify' | 'passkey' | null>(() => {
    switch (this.screen()) {
      case 'checking': return null;
      case 'access': return 'access';
      case 'code': return 'verify';
      case 'browser':
      case 'passkey': return 'passkey';
      default: return 'email';
    }
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
    this.router.navigateByUrl(pendingLink || '/tabs/home');
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