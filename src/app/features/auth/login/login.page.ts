import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { base64UrlDecode } from 'src/app/core/utils/base64url';
import { PENDING_DEEP_LINK_KEY, STEPUP_ACTION_KEY } from 'src/app/core/constants/deep-link.constants';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';

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

          <!-- Login form -->
          <ng-container *ngIf="!showInstallScreen || !(pwaInstall.installable$ | async)">
            <div class="fingerprint-hero">
              <div class="fp-circle" [class.fp-authenticating]="loading">
                <ion-icon name="finger-print-outline"></ion-icon>
              </div>
            </div>

            <h2 class="auth-title">{{ 'auth.login.title' | translate }}</h2>
            <p class="auth-subtitle">{{ 'auth.login.subtitle' | translate }}</p>

            <ion-button
              expand="block"
              (click)="login()"
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

            <div *ngIf="errorMessage" class="error-box">
              <ion-icon name="alert-circle-outline"></ion-icon>
              <span>{{ errorMessage }}</span>
            </div>
          </ng-container>
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './login.page.scss',
    imports: [IonicModule, CommonModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage {
  private readonly themeService = inject(ThemeService);
  readonly pwaInstall = inject(PwaInstallService);
  readonly logoSrc = this.themeService.getLogoUrl('dark');
  loading = false;
  errorMessage = '';
  showInstallScreen = !this.pwaInstall.isStandalone;

  private readonly authService = inject(AuthService);
  private readonly prfService = inject(PasskeyPrfService);
  private readonly router = inject(Router);

  async installApp(): Promise<void> {
    await this.pwaInstall.promptInstall();
  }

  skipInstall(): void {
    this.showInstallScreen = false;
  }

  async login(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      // Single biometric prompt — always local
      await this.authenticateLocally();

      // In server mode, also restore the JWT session
      if (this.authService instanceof RemoteAuthService) {
        await new Promise<void>((resolve, reject) => {
          (this.authService as RemoteAuthService).refreshAccessToken().subscribe({
            next: () => resolve(),
            error: () => {
              this.router.navigate(['/auth/register']);
              reject(new Error('Session expired. Please register again.'));
            }
          });
        });
      } else {
        (this.authService as LocalAuthService).markAuthenticated();
      }

      // Step-up action (native deep link while session was active) takes priority
      const stepUpUrl = localStorage.getItem(STEPUP_ACTION_KEY);
      if (stepUpUrl) {
        localStorage.removeItem(STEPUP_ACTION_KEY);
        try {
          const parsed = new URL(stepUpUrl);
          await this.router.navigateByUrl(parsed.pathname + parsed.search);
        } catch {
          await this.router.navigateByUrl('/tabs/home');
        }
        return;
      }

      const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
      sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
      await this.router.navigateByUrl(pendingLink || '/tabs/home');
    } catch (err: any) {
      this.errorMessage = err?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }

  private async authenticateLocally(): Promise<void> {
    const credentialId = this.prfService.getCredentialId();
    if (!credentialId) {
      this.router.navigate(['/auth/register']);
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
}
