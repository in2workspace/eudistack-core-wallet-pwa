import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from 'src/app/services/auth.service';
import { startAuthentication } from '@simplewebauthn/browser';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-login',
  template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

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
        </div>
      </div>
    </ion-content>
  `,
  styleUrl: './login.page.scss',
  standalone: true,
  imports: [IonicModule, CommonModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LoginPage {
  readonly logoSrc = environment.customizations.assets.base_url + '/' + environment.customizations.assets.logo_path;
  loading = false;
  errorMessage = '';

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  async login(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      // Step 1: Get assertion request from backend (usernameless / discoverable credential)
      const request = await new Promise<any>((resolve, reject) => {
        this.authService.startLogin().subscribe({
          next: resolve,
          error: reject
        });
      });

      // Step 2: Extract WebAuthn options for SimpleWebAuthn
      const assertionOptions = request.publicKeyCredentialRequestOptions ?? request;

      // Step 3: Browser shows passkey picker — no email needed
      const assertion = await startAuthentication({ optionsJSON: assertionOptions });

      // Step 4: Send assertion + full request to backend
      await new Promise<void>((resolve, reject) => {
        this.authService.finishLogin(JSON.stringify(assertion), JSON.stringify(request)).subscribe({
          next: () => resolve(),
          error: reject
        });
      });

      // Success — navigate to home
      this.router.navigate(['/tabs/home']);
    } catch (err: any) {
      console.error('Login error:', err);
      this.errorMessage = err?.error?.message || err?.message || 'Login failed';
    } finally {
      this.loading = false;
    }
  }
}
