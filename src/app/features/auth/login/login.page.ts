import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';
import { LocalAuthService } from 'src/app/core/services/local-auth.service';
import { startAuthentication } from '@simplewebauthn/browser';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';

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
              <div class="fp-circle">
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
              <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
              <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
              <span *ngIf="!loading">{{ 'auth.login.passkey-button' | translate }}</span>
            </ion-button>

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
      if (this.authService instanceof LocalAuthService) {
        await this.loginLocal(this.authService);
      } else {
        await this.loginRemote(this.authService as RemoteAuthService);
      }

      const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
      sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
      this.router.navigateByUrl(pendingLink || '/tabs/home');
    } catch (err: any) {
      console.error('Login error:', err);
      this.errorMessage = err?.error?.message || err?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }

  private async loginLocal(auth: LocalAuthService): Promise<void> {
    if (!auth.hasPasskey()) {
      this.router.navigate(['/auth/register']);
      return;
    }
    await auth.authenticate();
  }

  private async loginRemote(auth: RemoteAuthService): Promise<void> {
    const request = await new Promise<any>((resolve, reject) => {
      auth.startLogin().subscribe({ next: resolve, error: reject });
    });

    const assertionOptions = request.publicKeyCredentialRequestOptions ?? request;
    const assertion = await startAuthentication({ optionsJSON: assertionOptions });

    await new Promise<void>((resolve, reject) => {
      auth.finishLogin(JSON.stringify(assertion), JSON.stringify(request)).subscribe({
        next: () => resolve(),
        error: reject,
      });
    });
  }
}
