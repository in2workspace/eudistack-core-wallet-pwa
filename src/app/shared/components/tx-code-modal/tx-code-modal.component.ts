import { Component, Input, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { OtpInputComponent } from '../otp-input/otp-input.component';

@Component({
  selector: 'app-tx-code-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule, OtpInputComponent],
  template: `
    <div class="tx-code-content">
      <div class="tx-code-header">
        <ion-icon name="lock-closed-outline" class="tx-code-icon"></ion-icon>
        <h2>{{ header }}</h2>
      </div>

      <p class="tx-code-description" *ngIf="description">{{ description }}</p>

      <app-otp-input
        #txCodeRef
        [length]="txCodeLength"
        [autofocus]="true"
        [error]="!!error"
        (completed)="onCompleted($event)"
        (changed)="error = ''"
      ></app-otp-input>

      <p class="tx-code-counter" *ngIf="remainingSeconds > 0">
        {{ 'confirmation.time-remaining' | translate }}: <strong>{{ remainingSeconds }}s</strong>
      </p>

      <p class="tx-code-error" *ngIf="error">{{ error }}</p>

      <div class="tx-code-actions">
        <button class="tx-code-btn tx-code-btn-cancel" (click)="onCancel()">
          {{ 'confirmation.cancel' | translate }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .tx-code-content {
      padding: 32px 24px;
      text-align: center;
    }

    .tx-code-header {
      margin-bottom: 16px;

      ion-icon.tx-code-icon {
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

    .tx-code-description {
      font-size: 0.9rem;
      color: var(--text-secondary, #6B7280);
      margin: 0 0 20px;
      line-height: 1.4;
    }

    .tx-code-counter {
      font-size: 0.85rem;
      color: var(--text-secondary, #6B7280);
      margin: 16px 0 0;
    }

    .tx-code-error {
      font-size: 0.85rem;
      color: var(--status-error, #DC2626);
      margin: 12px 0 0;
      font-weight: 500;
    }

    .tx-code-actions {
      display: flex;
      justify-content: center;
      gap: 12px;
      margin-top: 20px;
    }

    .tx-code-btn {
      padding: 10px 24px;
      border-radius: var(--radius-md, 8px);
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;

      &:hover { opacity: 0.85; }
    }

    .tx-code-btn-cancel {
      background: var(--action-secondary, #F3F4F6);
      color: var(--action-secondary-text, #374151);
      border: 1px solid var(--border-default, #D1D5DB);
    }
  `],
})
export class TxCodeModalComponent {
  @ViewChild('txCodeRef') otpInput!: OtpInputComponent;

  @Input() header = 'PIN';
  @Input() description = '';
  @Input() txCodeLength = 6;
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
    this.modalCtrl.dismiss({ txCode: code }, 'confirm');
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
