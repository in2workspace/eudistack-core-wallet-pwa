import { Component, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { OtpInputComponent } from '../otp-input/otp-input.component';

@Component({
  selector: 'app-pin-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, OtpInputComponent],
  template: `
    <div class="pin-modal-backdrop">
      <div class="pin-modal-card" [class.card-enter]="true">
        <div class="pin-header">
          <ion-icon name="lock-closed-outline" class="pin-icon"></ion-icon>
          <h2>{{ header }}</h2>
        </div>

        <p class="pin-description" *ngIf="description">{{ description }}</p>

        <app-otp-input
          #pinRef
          [length]="pinLength"
          [autofocus]="true"
          [error]="!!error"
          (completed)="onCompleted($event)"
          (changed)="error = ''"
        ></app-otp-input>

        <p class="pin-counter" *ngIf="remainingSeconds > 0">
          {{ 'confirmation.time-remaining' | translate }}: <strong>{{ remainingSeconds }}s</strong>
        </p>

        <p class="pin-error" *ngIf="error">{{ error }}</p>

        <div class="pin-actions">
          <button class="pin-btn pin-btn-cancel" (click)="onCancel()">
            {{ 'confirmation.cancel' | translate }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .pin-modal-backdrop {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      padding: 24px;
      background: rgba(0, 0, 0, 0.5);
    }

    .pin-modal-card {
      width: 100%;
      max-width: 380px;
      background: var(--surface-card, #FFFFFF);
      border-radius: var(--radius-lg, 16px);
      padding: 32px 24px;
      box-shadow: var(--shadow-lg, 0 10px 15px rgba(0,0,0,0.1));
      text-align: center;

      &.card-enter {
        animation: cardSlideUp 0.3s ease-out;
      }
    }

    @keyframes cardSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .pin-header {
      margin-bottom: 16px;

      ion-icon.pin-icon {
        font-size: 40px;
        color: var(--action-primary, #2563EB);
        margin-bottom: 8px;
      }

      h2 {
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary, #1A1A2E);
        margin: 0;
      }
    }

    .pin-description {
      font-size: 0.9rem;
      color: var(--text-secondary, #6B7280);
      margin: 0 0 20px;
      line-height: 1.4;
    }

    .pin-counter {
      font-size: 0.85rem;
      color: var(--text-secondary, #6B7280);
      margin: 16px 0 0;
    }

    .pin-error {
      font-size: 0.85rem;
      color: var(--status-error, #DC2626);
      margin: 12px 0 0;
      font-weight: 500;
    }

    .pin-actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 20px;
    }

    .pin-btn {
      padding: 10px 24px;
      border-radius: var(--radius-md, 8px);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;

      &:hover { opacity: 0.85; }
    }

    .pin-btn-cancel {
      background: var(--action-secondary, #F3F4F6);
      color: var(--action-secondary-text, #374151);
      border: 1px solid var(--border-default, #D1D5DB);
    }
  `],
})
export class PinModalComponent {
  @ViewChild('pinRef') otpInput!: OtpInputComponent;

  @Input() header = 'PIN';
  @Input() description = '';
  @Input() pinLength = 4;
  @Input() timeoutSeconds = 55;

  remainingSeconds = 0;
  error = '';
  private interval: number | undefined;

  constructor(private modalCtrl: ModalController) {}

  ionViewDidEnter(): void {
    this.remainingSeconds = this.timeoutSeconds;
    this.startCountdown();
  }

  ionViewWillLeave(): void {
    this.clearCountdown();
  }

  onCompleted(code: string): void {
    this.clearCountdown();
    this.modalCtrl.dismiss({ pin: code }, 'confirm');
  }

  onCancel(): void {
    this.clearCountdown();
    this.modalCtrl.dismiss(null, 'cancel');
  }

  private startCountdown(): void {
    if (this.timeoutSeconds <= 0) return;

    this.interval = globalThis.setInterval(() => {
      this.remainingSeconds--;
      if (this.remainingSeconds <= 0) {
        this.clearCountdown();
        this.modalCtrl.dismiss(null, 'timeout');
      }
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.interval != null) {
      globalThis.clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
