import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from 'src/app/services/auth.service';
import { startRegistration } from '@simplewebauthn/browser';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-passkey-setup',
  template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <div class="success-badge">
            <ion-icon name="checkmark-circle"></ion-icon>
            <span>{{ 'auth.passkey.email-verified' | translate }}</span>
          </div>

          <div class="fingerprint-hero">
            <div class="fp-circle">
              <ion-icon name="finger-print-outline"></ion-icon>
            </div>
          </div>

          <h2 class="auth-title">{{ 'auth.passkey.title' | translate }}</h2>
          <p class="auth-description">{{ 'auth.passkey.description' | translate }}</p>

          <ion-button
            expand="block"
            (click)="registerPasskey()"
            [disabled]="loading"
            class="auth-button"
          >
            <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
            <ion-icon *ngIf="!loading" name="finger-print-outline" slot="start"></ion-icon>
            <span *ngIf="!loading">{{ 'auth.passkey.register-button' | translate }}</span>
          </ion-button>

          <div *ngIf="errorMessage" class="error-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
    </ion-content>
  `,
  styleUrl: './passkey-setup.page.scss',
  standalone: true,
  imports: [IonicModule, CommonModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class PasskeySetupPage {
  readonly logoSrc = environment.customizations.assets.base_url + '/' + environment.customizations.assets.logo_path;
  loading = false;
  errorMessage = '';

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  async registerPasskey(): Promise<void> {
    this.loading = true;
    this.errorMessage = '';

    try {
      // Step 1: Get creation options from backend (toCredentialsCreateJson format)
      // Response is { "publicKey": { rp, user, challenge, ... } }
      const response = await new Promise<any>((resolve, reject) => {
        this.authService.startPasskeyRegistration().subscribe({
          next: resolve,
          error: reject
        });
      });

      // Step 2: Unwrap the publicKey — SimpleWebAuthn expects top-level fields
      // The inner publicKey is identical to toJson() output
      const creationOptions = response.publicKey ?? response;

      // Step 3: Perform WebAuthn registration ceremony in browser
      const attestation = await startRegistration({ optionsJSON: creationOptions });

      // Step 4: Send attestation + unwrapped options to backend
      // Backend uses fromJson() which expects the flat format (same as toJson())
      await new Promise<void>((resolve, reject) => {
        this.authService.finishPasskeyRegistration(
          JSON.stringify(attestation), JSON.stringify(creationOptions)
        ).subscribe({
          next: () => resolve(),
          error: reject
        });
      });

      // Mark that this device has a passkey registered
      localStorage.setItem('wallet_has_passkey', 'true');

      // Success — navigate to home
      this.router.navigate(['/tabs/home']);
    } catch (err: any) {
      console.error('Passkey registration error:', err);
      this.errorMessage = err?.error?.message || err?.message || 'Passkey registration failed';
    } finally {
      this.loading = false;
    }
  }
}
