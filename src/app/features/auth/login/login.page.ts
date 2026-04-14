import { Component, inject, ViewChild, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
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

          <!-- PWA Install screen -->
          <ng-container *ngIf="showInstallScreen && (pwaInstall.installable$ | async)">
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
          </ng-container>

          <!-- Browser mode: simple passkey login -->
          <ng-container *ngIf="isBrowserMode && (!showInstallScreen || !(pwaInstall.installable$ | async))">
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

            <div *ngIf="loading" class="auth-status">
              <span class="status-dot"></span>
              <span class="status-dot"></span>
              <span class="status-dot"></span>
            </div>
          </ng-container>

          <!-- Server mode: email + OTP + passkey flow -->
          <ng-container *ngIf="!isBrowserMode && (!showInstallScreen || !(pwaInstall.installable$ | async))">
            <!-- Steps bar -->
            <div class="steps-bar">
              <div class="step" [class.active]="step === 'email'" [class.done]="step !== 'email'">
                <div class="step-dot">
                  <ion-icon *ngIf="step !== 'email'" name="checkmark"></ion-icon>
                  <span *ngIf="step === 'email'">1</span>
                </div>
                <span class="step-label">{{ 'auth.register.step-email' | translate }}</span>
              </div>
              <div class="step-line" [class.filled]="step !== 'email'"></div>
              <div class="step" [class.active]="step === 'code'" [class.done]="step === 'passkey'">
                <div class="step-dot">
                  <ion-icon *ngIf="step === 'passkey'" name="checkmark"></ion-icon>
                  <span *ngIf="step !== 'passkey'">2</span>
                </div>
                <span class="step-label">{{ 'auth.register.step-verify' | translate }}</span>
              </div>
              <div class="step-line" [class.filled]="step === 'passkey'"></div>
              <div class="step" [class.active]="step === 'passkey'">
                <div class="step-dot"><span>3</span></div>
                <span class="step-label">{{ 'auth.passkey.title' | translate }}</span>
              </div>
            </div>

            <h2 class="auth-title">{{ 'auth.login.title' | translate }}</h2>
            <p class="auth-subtitle">
              <span *ngIf="step === 'email'">{{ 'auth.login.enter-email' | translate }}</span>
              <span *ngIf="step === 'code'">{{ 'auth.register.code-sent' | translate }}</span>
              <span *ngIf="step === 'passkey'">{{ 'auth.login.verify-passkey' | translate }}</span>
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

              <ion-button expand="block" (click)="sendCode()" [disabled]="!email || loading" class="auth-button">
                <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                <ion-icon *ngIf="!loading" name="paper-plane-outline" slot="start"></ion-icon>
                <span *ngIf="!loading">{{ 'auth.register.send-code' | translate }}</span>
              </ion-button>
            </div>

            <!-- Step 2: OTP code -->
            <div *ngIf="step === 'code'" class="auth-form">
              <div class="email-badge">
                <ion-icon name="mail-outline"></ion-icon>
                <span>{{ email }}</span>
              </div>

              <app-otp-input
                #otpRef
                [length]="6"
                [autofocus]="true"
                [error]="!!errorMessage"
                (completed)="onOtpCompleted($event)"
                (changed)="otpValue = $event; errorMessage = ''"
              ></app-otp-input>

              <ion-button expand="block" (click)="verifyCode()" [disabled]="otpValue.length < 6 || loading" class="auth-button">
                <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
                <ion-icon *ngIf="!loading" name="shield-checkmark-outline" slot="start"></ion-icon>
                <span *ngIf="!loading">{{ 'auth.register.verify' | translate }}</span>
              </ion-button>

              <ion-button expand="block" fill="clear" (click)="goBackToEmail()" class="secondary-button">
                <ion-icon name="arrow-back-outline" slot="start"></ion-icon>
                {{ 'auth.register.change-email' | translate }}
              </ion-button>
            </div>

            <!-- Step 3: Passkey verification -->
            <div *ngIf="step === 'passkey'" class="auth-form">
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
          </ng-container>

          <div *ngIf="errorMessage" class="error-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './login.page.scss',
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule, OtpInputComponent]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage implements OnInit {
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

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly router = inject(Router);

  readonly isBrowserMode = this.authService instanceof LocalAuthService;

  ngOnInit(): void {
    // En server mode, si ya hay una sesión válida (refresh token válido),
    // podemos saltar directamente al paso de passkey
    if (!this.isBrowserMode) {
      const hasRefreshToken = !!localStorage.getItem('wallet_refresh_token');
      if (hasRefreshToken) {
        // Intentar refrescar el token silenciosamente
        (this.authService as RemoteAuthService).refreshAccessToken().subscribe({
          next: () => {
            // Sesión válida, ir directamente al paso de passkey
            this.step = 'passkey';
          },
          error: () => {
            // Token expirado, empezar desde email
            this.step = 'email';
          }
        });
      }
    }
  }

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
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

    (this.authService as RemoteAuthService).register(this.email).subscribe({
      next: () => {
        this.step = 'code';
        this.otpValue = '';
        this.loading = false;
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to send verification code';
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
        // Email verified, ahora verificar passkey local
        this.step = 'passkey';
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Invalid verification code';
        this.loading = false;
      }
    });
  }

  async verifyPasskey(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      const credentialId = this.prfService.getCredentialId();
      
      if (!credentialId) {
        // No hay passkey local registrado, redirigir a register para crear uno
        this.router.navigate(['/auth/register'], {
          queryParams: { reauth: 'true' }
        });
        return;
      }

      await this.authenticateLocally();
      this.navigateHome();
    } catch (err: any) {
      this.errorMessage = err?.message || 'Passkey verification failed';
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
}
