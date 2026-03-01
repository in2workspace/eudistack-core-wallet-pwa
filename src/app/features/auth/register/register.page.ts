import { Component, inject, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { ThemeService } from 'src/app/core/services/theme.service';

@Component({
    selector: 'app-register',
    template: `
    <ion-content [fullscreen]="true" class="auth-bg">
      <div class="auth-wrapper">
        <div class="auth-card" [class.card-enter]="true">
          <div class="auth-logo">
            <img [src]="logoSrc" alt="Logo" class="logo-img" />
          </div>

          <!-- Step indicator -->
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
              <div class="step-dot">
                <span>2</span>
              </div>
              <span class="step-label">{{ 'auth.register.step-verify' | translate }}</span>
            </div>
          </div>

          <h2 class="auth-title">{{ 'auth.register.title' | translate }}</h2>
          <p class="auth-subtitle">{{ step === 'email' ? ('auth.register.subtitle' | translate) : ('auth.register.code-sent' | translate) }}</p>

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

            <ion-button
              expand="block"
              (click)="sendCode()"
              [disabled]="!email || loading"
              class="auth-button"
            >
              <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
              <ion-icon *ngIf="!loading" name="paper-plane-outline" slot="start"></ion-icon>
              <span *ngIf="!loading">{{ 'auth.register.send-code' | translate }}</span>
            </ion-button>
          </div>

          <!-- Step 2: Verification code -->
          <div *ngIf="step === 'code'" class="auth-form">
            <div class="email-badge">
              <ion-icon name="mail-outline"></ion-icon>
              <span>{{ email }}</span>
            </div>

            <div class="otp-container">
              <input
                *ngFor="let d of digits; let i = index"
                #otpInput
                type="text"
                inputmode="numeric"
                maxlength="1"
                class="otp-box"
                [class.filled]="digits[i] !== ''"
                [value]="digits[i]"
                (input)="onOtpInput($event, i)"
                (keydown)="onOtpKeydown($event, i)"
                (paste)="onOtpPaste($event)"
                (focus)="onOtpFocus(i)"
              />
            </div>

            <ion-button
              expand="block"
              (click)="verifyCode()"
              [disabled]="otpCode.length < 6 || loading"
              class="auth-button"
            >
              <ion-spinner *ngIf="loading" name="crescent" class="btn-spinner"></ion-spinner>
              <ion-icon *ngIf="!loading" name="shield-checkmark-outline" slot="start"></ion-icon>
              <span *ngIf="!loading">{{ 'auth.register.verify' | translate }}</span>
            </ion-button>

            <ion-button
              expand="block"
              fill="clear"
              (click)="step = 'email'; errorMessage = ''; digits = ['', '', '', '', '', '']"
              class="secondary-button"
            >
              <ion-icon name="arrow-back-outline" slot="start"></ion-icon>
              {{ 'auth.register.change-email' | translate }}
            </ion-button>
          </div>

          <div *ngIf="errorMessage" class="error-box">
            <ion-icon name="alert-circle-outline"></ion-icon>
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
    </ion-content>
  `,
    styleUrl: './register.page.scss',
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class RegisterPage {
  @ViewChildren('otpInput') otpInputs!: QueryList<ElementRef<HTMLInputElement>>;

  private readonly themeService = inject(ThemeService);
  readonly logoSrc = this.themeService.snapshot?.branding?.logoUrl ?? null;
  email = '';
  digits: string[] = ['', '', '', '', '', ''];
  step: 'email' | 'code' = 'email';
  loading = false;
  errorMessage = '';

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  get otpCode(): string {
    return this.digits.join('');
  }

  onOtpInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '');

    if (value) {
      this.digits[index] = value[0];
      input.value = value[0];
      // Auto-advance to next box
      if (index < 5) {
        this.focusInput(index + 1);
      } else if (this.otpCode.length === 6 && !this.loading) {
        this.verifyCode();
      }
    } else {
      this.digits[index] = '';
      input.value = '';
    }
  }

  onOtpKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace') {
      if (this.digits[index] === '' && index > 0) {
        // Box is empty, go back to previous
        this.digits[index - 1] = '';
        this.focusInput(index - 1);
        event.preventDefault();
      } else {
        this.digits[index] = '';
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      this.focusInput(index - 1);
      event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < 5) {
      this.focusInput(index + 1);
      event.preventDefault();
    } else if (event.key === 'Enter' && this.otpCode.length === 6 && !this.loading) {
      this.verifyCode();
    }
  }

  onOtpPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;

    for (let i = 0; i < 6; i++) {
      this.digits[i] = pasted[i] || '';
    }

    // Focus the next empty box or the last one
    const nextEmpty = this.digits.findIndex(d => d === '');
    this.focusInput(nextEmpty >= 0 ? nextEmpty : 5);

    if (this.otpCode.length === 6 && !this.loading) {
      this.verifyCode();
    }
  }

  onOtpFocus(index: number): void {
    // Select content on focus for easy overwrite
    const inputs = this.otpInputs?.toArray();
    if (inputs?.[index]) {
      inputs[index].nativeElement.select();
    }
  }

  sendCode(): void {
    this.loading = true;
    this.errorMessage = '';

    this.authService.register(this.email).subscribe({
      next: () => {
        this.step = 'code';
        this.digits = ['', '', '', '', '', ''];
        this.loading = false;
        // Focus first OTP box after view updates
        setTimeout(() => this.focusInput(0), 100);
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

    this.authService.verifyEmail(this.email, this.otpCode).subscribe({
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

  private focusInput(index: number): void {
    const inputs = this.otpInputs?.toArray();
    if (inputs?.[index]) {
      inputs[index].nativeElement.focus();
    }
  }
}
