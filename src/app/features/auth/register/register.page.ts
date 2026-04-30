import { Component, inject, ViewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { OtpInputComponent } from 'src/app/shared/components/otp-input/otp-input.component';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { PasskeyApiService } from 'src/app/core/services/passkey-api.service';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

@Component({
    selector: 'app-register',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <!-- Pending install decision -->
          <ng-container *ngIf="(pwaInstall.installDecision$ | async) === null">
            <div class="auth-checking">
              <ion-spinner name="crescent"></ion-spinner>
            </div>
          </ng-container>

          <!-- Install screen -->
          <ng-container *ngIf="(pwaInstall.installDecision$ | async) === true && showInstallScreen">
            <div class="install-hero">
              <div class="install-icon-circle">
                <ion-icon name="download-outline"></ion-icon>
              </div>
            </div>

            <h2 class="auth-title">{{ 'auth.register.install-title' | translate }}</h2>
            <p class="auth-subtitle">{{ 'auth.register.install-subtitle' | translate }}</p>

            <ion-button
              expand="block"
              (click)="installApp()"
              class="auth-button"
            >
              <ion-icon name="download-outline" slot="start"></ion-icon>
              {{ 'auth.register.install-button' | translate }}
            </ion-button>

            <ion-button
              expand="block"
              fill="clear"
              (click)="skipInstall()"
              class="secondary-button"
            >
              {{ 'auth.register.continue-browser' | translate }}
            </ion-button>
          </ng-container>

          <!-- Browser mode: simple passkey creation -->
          <ng-container *ngIf="isBrowserMode && ((pwaInstall.installDecision$ | async) === false || !showInstallScreen)">
            <h2 class="auth-title">{{ 'auth.register.title' | translate }}</h2>
            <p class="auth-subtitle">{{ 'auth.register.passkey-subtitle' | translate }}</p>

            <ion-button
              expand="block"
              (click)="createWallet()"
              [disabled]="loading"
              class="auth-button"
            >
              <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
              <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
              <span *ngIf="!loading">{{ 'auth.register.create-wallet' | translate }}</span>
            </ion-button>
          </ng-container>

          <!-- AC-008.8: iOS standalone EBW divergence warning (informational, non-blocking) -->
          <div *ngIf="isStandaloneDivergence" class="standalone-divergence-banner" role="alert">
            <ion-icon name="information-circle-outline" aria-hidden="true"></ion-icon>
            <div>
              <strong>{{ 'ios-install.standalone-divergence-title' | translate }}</strong>
              <span>{{ 'ios-install.standalone-divergence-subtitle' | translate }}</span>
            </div>
          </div>

          <!-- Server mode: email + OTP flow, then local passkey creation -->
          <ng-container *ngIf="!isBrowserMode && ((pwaInstall.installDecision$ | async) === false || !showInstallScreen)">
            <h2 class="auth-title">
              {{ isReauthMode ? ('auth.login.title' | translate) : ('auth.register.title' | translate) }}
            </h2>
            <p class="auth-subtitle">
              <span *ngIf="step === 'email'">
                {{ isReauthMode ? ('auth.reauth.subtitle' | translate) : ('auth.register.subtitle' | translate) }}
              </span>
              <span *ngIf="step === 'code'">{{ 'auth.register.code-sent' | translate }}</span>
              <span *ngIf="step === 'passkey'">{{ 'auth.passkey.description' | translate }}</span>
            </p>

            <!-- Step 1: Email -->
            <div *ngIf="step === 'email'" class="auth-form">
              <div class="input-group">
                <ion-icon name="mail-outline" class="input-icon"></ion-icon>
                <ion-input
                  [(ngModel)]="email"
                  type="email"
                  [placeholder]="'auth.register.email-placeholder' | translate"
                  class="modern-input"
                  (keyup.enter)="email && !loading && sendCode()"
                ></ion-input>
              </div>

              <ion-button expand="block" (click)="email && !loading && sendCode()" [disabled]="loading" [class.inactive-email]="!email && !loading" class="auth-button">
                <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                <ion-icon *ngIf="!loading" name="paper-plane-outline" slot="start"></ion-icon>
                <span *ngIf="!loading">{{ 'auth.register.send-code' | translate }}</span>
              </ion-button>

              <!-- Already registered link -->
              <ion-button *ngIf="!isReauthMode" expand="block" fill="clear" (click)="goBackToLogin()" class="secondary-button">
                {{ 'auth.register.already-registered' | translate }}
              </ion-button>

              <!-- Back to login button in reauth mode -->
              <ion-button *ngIf="isReauthMode" expand="block" fill="clear" (click)="goBackToLogin()" class="secondary-button">
                <ion-icon name="arrow-back-outline" slot="start"></ion-icon>
                {{ 'auth.reauth.back-to-login' | translate }}
              </ion-button>
            </div>

            <!-- Step 2: OTP code -->
            <div *ngIf="step === 'code'" class="auth-form">
              <div class="email-badge">
                <span>{{ email }}</span>
              </div>

              <app-otp-input
                #otpRef
                [length]="6"
                [autofocus]="true"
                [error]="!!errorMessage"
                (changed)="otpValue = $event; errorMessage = ''"
              ></app-otp-input>

              <ion-button expand="block" (click)="otpValue.length >= 6 && !loading && verifyCode()" [disabled]="loading" [class.inactive-email]="otpValue.length < 6 && !loading" class="auth-button">
                <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                <ion-icon *ngIf="!loading" name="shield-checkmark-outline" slot="start"></ion-icon>
                <span *ngIf="!loading">{{ 'auth.register.verify' | translate }}</span>
              </ion-button>

              <ion-button expand="block" fill="clear" (click)="goBackToEmail()" class="secondary-button">
                {{ 'auth.register.change-email' | translate }}
              </ion-button>
            </div>

            <!-- Step 3: Passkey creation -->
            <div *ngIf="step === 'passkey'" class="auth-form">
              <div class="fingerprint-hero">
                <div class="fp-circle" [class.fp-authenticating]="loading">
                  <ion-icon name="finger-print-outline"></ion-icon>
                </div>
              </div>

              <ion-button expand="block" (click)="createPasskeyAndFinish()" [disabled]="loading" class="auth-button">
                <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
                <span *ngIf="!loading">{{ 'auth.passkey.register-button' | translate }}</span>
              </ion-button>
            </div>
          </ng-container>

          <div *ngIf="errorMessage" class="error-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './register.page.scss',
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule, OtpInputComponent]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class RegisterPage implements OnInit {
  @ViewChild('otpRef') otpInput!: OtpInputComponent;

  private readonly themeService = inject(ThemeService);
  private readonly route = inject(ActivatedRoute);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly passkeyApi = inject(PasskeyApiService);

  readonly pwaInstall = inject(PwaInstallService);
  readonly logoSrc = this.themeService.getLogoUrl('dark');

  email = '';
  otpValue = '';
  step: 'email' | 'code' | 'passkey' = 'email';
  loading = false;
  errorMessage = '';
  showInstallScreen = !this.pwaInstall.isStandalone;
  verifiedEmail = false;

  /** True if user has a passkey but needs to re-authenticate (session expired) */
  isReauthMode = false;

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly isBrowserMode = this.authService instanceof LocalAuthService;

  /**
   * AC-008.8: iOS standalone + EBW mode + empty storage.
   * Indicates the user likely had data in Safari that is not available here.
   */
  readonly isStandaloneDivergence =
    this.pwaInstall.isStandalone &&
    !this.isBrowserMode &&
    !this.passkeyStore.hasPasskey();

  ngOnInit(): void {
    // Check if we're in re-authentication mode (passkey exists but session expired)
    const reauth = this.route.snapshot.queryParamMap.get('reauth');
    this.isReauthMode = reauth === 'true' && this.passkeyStore.hasPasskey();
  }

  // --- PWA Install ---

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
    this.showInstallScreen = false;
  }

  skipInstall(): void {
    this.showInstallScreen = false;
  }

  // --- Browser mode: single-step passkey creation ---

  async createWallet(): Promise<void> {
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

  // --- Server mode: email + OTP + local passkey ---

  onOtpCompleted(code: string): void {
    if (!this.loading) {
      this.otpValue = code;
      this.verifyCode();
    }
  }

  goBackToEmail(): void {
    this.step = 'email';
    this.errorMessage = '';
    this.otpValue = '';
  }

  goBackToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  sendCode(): void {
    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).register(this.email).subscribe({
      next: () => {
        this.step = 'code';
        this.otpValue = '';
        this.loading = false;
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
    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).verifyEmail(this.email, this.otpValue).subscribe({
      next: () => {
        this.loading = false;
        this.verifiedEmail = true;

        if (this.isReauthMode || this.passkeyStore.hasPasskey()) {
          this.navigateHome();
        } else {
          this.step = 'passkey';
        }
      },
      error: (err) => {
        this.errorMessage = err?.status === 429
          ? this.translate.instant('auth.errors.too-many-attempts-otp')
          : (err?.error?.message || err?.error?.detail || 'Invalid verification code');
        this.loading = false;
      }
    });
  }

  async createPasskeyAndFinish(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      await this.prfService.createPasskey(this.email || 'Wallet User');

      // Navigate immediately — server registration happens in background
      this.navigateHome();

      const credentialId = this.passkeyStore.getCredentialId();
      if (credentialId) {
        this.passkeyApi.registerPasskey({
          credentialId,
          displayName: this.getDeviceName(),
          userAgent: navigator.userAgent
        }).subscribe({
          error: (err: any) => console.warn('Failed to register passkey on server:', err)
        });
      }
    } catch (err: any) {
      this.errorMessage = err?.message || 'Failed to create passkey';
      this.loading = false;
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
}
