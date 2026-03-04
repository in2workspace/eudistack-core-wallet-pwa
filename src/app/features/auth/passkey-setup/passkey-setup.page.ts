import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { startRegistration } from '@simplewebauthn/browser';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { ThemeService } from 'src/app/core/services/theme.service';

@Component({
    selector: 'app-passkey-setup',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true" [class.card-exit]="cardExit">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <div class="success-badge">
            <ion-icon name="checkmark-circle"></ion-icon>
            <span>{{ 'auth.passkey.email-verified' | translate }}</span>
          </div>

          <div class="fingerprint-hero">
            <div class="fp-circle"
                 [class.fp-connecting]="state === 'connecting'"
                 [class.fp-verifying]="state === 'verifying'"
                 [class.fp-success]="state === 'success'">
              <ion-icon *ngIf="state !== 'success'" name="finger-print-outline"></ion-icon>
              <ion-icon *ngIf="state === 'success'" name="checkmark-sharp" class="check-icon"></ion-icon>
            </div>
          </div>

          <h2 class="auth-title">{{ 'auth.passkey.title' | translate }}</h2>
          <p class="auth-description">
            <span *ngIf="state === 'idle' || state === 'error'">{{ 'auth.passkey.description' | translate }}</span>
            <span *ngIf="state === 'connecting'" class="status-text">{{ 'auth.passkey.status-connecting' | translate }}</span>
            <span *ngIf="state === 'verifying'" class="status-text">{{ 'auth.passkey.status-verifying' | translate }}</span>
            <span *ngIf="state === 'success'" class="status-text status-success">{{ 'auth.passkey.success' | translate }}</span>
          </p>

          <ion-button
            expand="block"
            (click)="registerPasskey()"
            [disabled]="state !== 'idle'"
            class="auth-button"
            [class.btn-success]="state === 'success'"
          >
            <ion-icon *ngIf="state === 'idle'" name="finger-print-outline" slot="start"></ion-icon>
            <span *ngIf="state === 'idle'">{{ 'auth.passkey.register-button' | translate }}</span>

            <ion-spinner *ngIf="state === 'connecting' || state === 'verifying'" name="crescent" class="btn-spinner"></ion-spinner>
            <span *ngIf="state === 'connecting'">{{ 'auth.passkey.status-connecting' | translate }}</span>
            <span *ngIf="state === 'verifying'">{{ 'auth.passkey.status-verifying' | translate }}</span>

            <ion-icon *ngIf="state === 'success'" name="checkmark-circle" slot="start"></ion-icon>
            <span *ngIf="state === 'success'">{{ 'auth.passkey.success' | translate }}</span>
          </ion-button>

          <div *ngIf="state === 'error'" class="error-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span>{{ errorMessage }}</span>
          </div>
          <ion-button *ngIf="state === 'error'" expand="block" fill="clear" (click)="retryRegistration()" class="retry-button">
            <ion-icon name="refresh-outline" slot="start"></ion-icon>
            {{ 'auth.passkey.retry' | translate }}
          </ion-button>
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './passkey-setup.page.scss',
    imports: [IonicModule, CommonModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class PasskeySetupPage {
  private readonly themeService = inject(ThemeService);
  readonly logoSrc = this.themeService.getLogoUrl('dark');
  state: 'idle' | 'connecting' | 'verifying' | 'success' | 'error' = 'idle';
  cardExit = false;
  errorMessage = '';

  private readonly authService = inject(AuthService) as RemoteAuthService;
  private readonly router = inject(Router);

  private detectDevice(): string {
    const ua = navigator.userAgent;
    let browser = 'Browser';
    let os = 'Device';

    if (ua.includes('Firefox/')) browser = 'Firefox';
    else if (ua.includes('Edg/')) browser = 'Edge';
    else if (ua.includes('OPR/') || ua.includes('Opera')) browser = 'Opera';
    else if (ua.includes('Chrome/') && !ua.includes('Edg/')) browser = 'Chrome';
    else if (ua.includes('Safari/') && !ua.includes('Chrome')) browser = 'Safari';

    if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Mac OS')) os = 'macOS';
    else if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Linux')) os = 'Linux';

    return `${browser} on ${os}`;
  }

  retryRegistration(): void {
    this.state = 'idle';
    this.errorMessage = '';
  }

  async registerPasskey(): Promise<void> {
    this.state = 'connecting';
    this.errorMessage = '';

    try {
      const response = await new Promise<any>((resolve, reject) => {
        this.authService.startPasskeyRegistration().subscribe({
          next: resolve,
          error: reject
        });
      });

      const creationOptions = response.publicKey ?? response;

      this.state = 'verifying';
      const attestation = await startRegistration({ optionsJSON: creationOptions });

      this.state = 'connecting';
      const deviceInfo = this.detectDevice();
      await new Promise<void>((resolve, reject) => {
        this.authService.finishPasskeyRegistration(
          JSON.stringify(attestation), JSON.stringify(creationOptions), deviceInfo
        ).subscribe({
          next: () => resolve(),
          error: reject
        });
      });

      localStorage.setItem('wallet_has_passkey', 'true');
      this.state = 'success';

      await this.delay(500);
      this.cardExit = true;
      await this.delay(300);

      const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
      sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
      this.router.navigateByUrl(pendingLink || '/tabs/home');
    } catch (err: any) {
      console.error('Passkey registration error:', err);
      this.errorMessage = err?.error?.message || err?.message || 'Passkey registration failed';
      this.state = 'error';
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
