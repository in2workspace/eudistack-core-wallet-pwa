import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
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

@Component({
    selector: 'app-login',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <!-- Pending install decision -->
          @if ((pwaInstall.installDecision$ | async) === null) {
            <div class="auth-checking">
              <ion-spinner name="crescent"></ion-spinner>
            </div>
          }

          <!-- Install screen -->
          @if ((pwaInstall.installDecision$ | async) === true && showInstallScreen) {
            <div class="fingerprint-hero">
              <div class="fp-circle install-circle">
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
          }

          <!-- Login form -->
          @if (isBrowserMode && ((pwaInstall.installDecision$ | async) === false || !showInstallScreen)) {
            <div class="fingerprint-hero">
              <div class="fp-circle" [class.fp-authenticating]="loading">
                <ion-icon name="finger-print-outline"></ion-icon>
              </div>
            </div>

            <h2 class="auth-title">{{ 'auth.login.title' | translate }}</h2>
            <p class="auth-subtitle">{{ 'auth.login.subtitle' | translate }}</p>

            <ion-button
              expand="block"
              (click)="loginBrowserMode()"
              [disabled]="loading"
              class="auth-button"
            >
              <ion-icon name="finger-print-outline" slot="start"></ion-icon>
              {{ 'auth.login.passkey-button' | translate }}
            </ion-button>

            @if (loading) {
              <div class="auth-status">
                <span class="status-dot"></span>
                <span class="status-dot"></span>
                <span class="status-dot"></span>
              </div>
            }
            }

            <!-- Server mode: email + OTP + passkey flow -->
            <ng-container *ngIf="!isBrowserMode && ((pwaInstall.installDecision$ | async) === false || !showInstallScreen)">
              <h2 class="auth-title">{{ (step === 'passkey' ? 'auth.login.title-welcome' : 'auth.login.title') | translate }}</h2>
              <p class="auth-subtitle">
                <span *ngIf="step === 'email'">{{ 'auth.login.enter-email' | translate }}</span>
                <span *ngIf="step === 'code'">{{ 'auth.register.code-sent' | translate }}</span>
                <span *ngIf="step === 'passkey' && !needsPasskeySetup">{{ 'auth.login.verify-passkey' | translate }}</span>
                <span *ngIf="step === 'passkey' && needsPasskeySetup">{{ 'auth.passkey.description' | translate }}</span>
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

              <!-- Step 3a: Verify existing passkey -->
              <div *ngIf="step === 'passkey' && !needsPasskeySetup" class="auth-form">
                <div class="fingerprint-hero">
                  <div class="fp-circle" [class.fp-authenticating]="loading">
                    <ion-icon name="finger-print-outline"></ion-icon>
                  </div>
                </div>

                <ion-button expand="block" (click)="verifyPasskey()" [disabled]="loading" class="auth-button">
                  <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                  <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
                  <span *ngIf="!loading">{{ 'auth.login.passkey-button' | translate }}</span>
                </ion-button>
              </div>

              <!-- Step 3b: Create passkey on this new device -->
              <div *ngIf="step === 'passkey' && needsPasskeySetup" class="auth-form">
                <div class="fingerprint-hero">
                  <div class="fp-circle" [class.fp-authenticating]="loading">
                    <ion-icon name="finger-print-outline"></ion-icon>
                  </div>
                </div>

                <ion-button expand="block" (click)="createPasskeyForDevice()" [disabled]="loading" class="auth-button">
                  <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                  <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
                  <span *ngIf="!loading">{{ 'auth.passkey.register-button' | translate }}</span>
                </ion-button>
              </div>
            </ng-container>

            @if (errorMessage) {
              <div class="error-box">
                <ion-icon name="alert-circle-outline"></ion-icon>
                <span>{{ errorMessage }}</span>
              </div>
            }
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './login.page.scss',
  imports: [AsyncPipe, CommonModule, FormsModule, IonicModule, OtpInputComponent, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage {
  @ViewChild('otpRef') otpInput!: OtpInputComponent;

  private readonly themeService = inject(ThemeService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly logoSrc = this.themeService.getLogoUrl('dark');
  loading = false;
  errorMessage = '';
  showInstallScreen = !this.pwaInstall.isStandalone;

  // Server mode: multi-step flow
  email = '';
  otpValue = '';
  step: 'email' | 'code' | 'passkey' = 'email';
  needsPasskeySetup = false;
  private passkeyFromRefreshToken = false;

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly passkeyApi = inject(PasskeyApiService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly isBrowserMode = this.authService instanceof LocalAuthService;

  ionViewWillEnter(): void {
    this.loading = false;
    this.errorMessage = '';

    if (!this.isBrowserMode && localStorage.getItem('wallet_refresh_token')) {
      this.step = 'passkey';
      this.passkeyFromRefreshToken = true;
      this.needsPasskeySetup = !this.prfService.hasPasskey();
    } else {
      this.step = 'email';
      this.passkeyFromRefreshToken = false;
      this.needsPasskeySetup = false;
    }
  }

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
    this.showInstallScreen = false;
  }

  skipInstall(): void {
    this.showInstallScreen = false;
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

  // --- Server mode: email + OTP + passkey flow ---

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

  sendCode(): void {
    this.loading = true;
    this.errorMessage = '';

    (this.authService as RemoteAuthService).register(this.email, 'login').subscribe({
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
        this.passkeyFromRefreshToken = false;
        this.needsPasskeySetup = !this.prfService.hasPasskey();
        this.step = 'passkey';
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

      this.navigateHome();
    } catch (err: any) {
      if (this.passkeyFromRefreshToken) {
        localStorage.removeItem('wallet_refresh_token');
        this.passkeyFromRefreshToken = false;
        this.step = 'email';
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

    try {
      await this.prfService.createPasskey(this.email || 'Wallet User');

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

  // --- Private helpers ---

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
}
