import { Component, inject, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { OtpInputComponent } from 'src/app/shared/components/otp-input/otp-input.component';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';

@Component({
    selector: 'app-register',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <!-- PWA Install screen (shown before registration when installable) -->
          <ng-container *ngIf="showInstallScreen && (pwaInstall.installable$ | async)">
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
          <ng-container *ngIf="isBrowserMode && (!showInstallScreen || !(pwaInstall.installable$ | async))">
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

          <!-- Server mode: email + OTP flow -->
          <ng-container *ngIf="!isBrowserMode && (!showInstallScreen || !(pwaInstall.installable$ | async))">
            <div class="steps-bar">
              <div class="step" [class.active]="step === 'email'" [class.done]="step === 'code'">
                <div class="step-dot">
                  <ion-icon *ngIf="step === 'code'" name="checkmark"></ion-icon>
                  <span *ngIf="step === 'email'">1</span>
                </div>
                <span class="step-label">{{ 'auth.register.step-email' | translate }}</span>
              </div>
              <div class="step-line" [class.filled]="step === 'code'"></div>
              <div class="step" [class.active]="step === 'code'">
                <div class="step-dot"><span>2</span></div>
                <span class="step-label">{{ 'auth.register.step-verify' | translate }}</span>
              </div>
            </div>

            <h2 class="auth-title">{{ 'auth.register.title' | translate }}</h2>
            <p class="auth-subtitle">{{ step === 'email' ? ('auth.register.subtitle' | translate) : ('auth.register.code-sent' | translate) }}</p>

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
export class RegisterPage {
  @ViewChild('otpRef') otpInput!: OtpInputComponent;

  private readonly themeService = inject(ThemeService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly logoSrc = this.themeService.getLogoUrl('dark');
  email = '';
  otpValue = '';
  step: 'email' | 'code' = 'email';
  loading = false;
  errorMessage = '';
  showInstallScreen = !this.pwaInstall.isStandalone;

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly isBrowserMode = this.authService instanceof LocalAuthService;

  // --- PWA Install ---

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
  }

  skipInstall(): void {
    this.showInstallScreen = false;
  }

  // --- Browser mode ---

  async createWallet(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      await (this.authService as LocalAuthService).setupPasskey();
      this.router.navigateByUrl('/tabs/home');
    } catch (err: any) {
      this.errorMessage = err?.message || 'Failed to create passkey';
    } finally {
      this.loading = false;
    }
  }

  // --- Server mode ---

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
        this.router.navigate(['/auth/passkey-setup']);
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Invalid verification code';
        this.loading = false;
      }
    });
  }
}
