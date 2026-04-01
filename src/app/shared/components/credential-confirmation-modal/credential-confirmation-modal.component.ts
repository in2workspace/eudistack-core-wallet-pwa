import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CredentialPreview } from '../../../core/models/credential-preview';

@Component({
  selector: 'app-credential-confirmation-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  template: `
    <div class="modal-backdrop">
      <div class="modal-content" [class.enter]="animateIn">

        <div class="modal-header">
          <div class="icon-wrapper" [class.icon-enter]="animateIn">
            <ion-icon name="shield-checkmark-outline"></ion-icon>
          </div>
          <h2>{{ 'confirmation.new-credential-title' | translate }}</h2>
          <p class="subtitle">{{ 'confirmation.new-credential' | translate }}</p>
        </div>

        <div class="credential-card" [class.card-enter]="animateIn">
          <div class="card-header">
            <span class="credential-name">{{ preview.displayName }}</span>
            <span class="format-badge" *ngIf="preview.format">{{ formatLabel }}</span>
          </div>

          <div class="card-divider"></div>

          <div class="card-sections">
            <div class="section-block" *ngFor="let section of preview.sections">
              <span class="section-title">{{ section.section }}</span>
              <div class="section-fields">
                <ng-container *ngFor="let field of section.fields">
                  <!-- Structured field (array of objects like powers) -->
                  <div class="field-row" *ngIf="field.structured?.length; else simpleField">
                    <span class="field-label">{{ field.label }}</span>
                    <div class="structured-list">
                      <div class="structured-item" *ngFor="let item of field.structured">
                        <span class="structured-entry">
                          <span class="structured-key">{{ item.label }}</span>
                          <span class="structured-val">{{ item.value }}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                  <!-- Simple text field -->
                  <ng-template #simpleField>
                    <div class="field-row">
                      <span class="field-label">{{ field.label }}</span>
                      <span class="field-value">{{ field.value }}</span>
                    </div>
                  </ng-template>
                </ng-container>
              </div>
            </div>
          </div>

          <div class="card-expiration" *ngIf="preview.expirationDate">
            <div class="card-divider"></div>
            <div class="expiration-row">
              <ion-icon name="calendar-outline"></ion-icon>
              <span>{{ 'confirmation.expiration' | translate }}{{ formattedExpiration }}</span>
            </div>
          </div>
        </div>

        <div class="countdown-section" *ngIf="remainingSeconds > 0">
          <div class="countdown-bar-track">
            <div class="countdown-bar-fill" [style.width.%]="countdownPercent"></div>
          </div>
          <span class="countdown-text">
            {{ 'confirmation.time-remaining' | translate }}: <strong>{{ remainingSeconds }}s</strong>
          </span>
        </div>

        <div class="modal-actions">
          <button class="btn btn-outline" (click)="onReject()">
            {{ 'confirmation.cancel' | translate }}
          </button>
          <button class="btn btn-primary" (click)="onAccept()">
            {{ 'confirmation.accept' | translate }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .modal-backdrop {
      display: flex; align-items: center; justify-content: center;
      min-height: 100%; padding: 16px;
      background: rgba(15,15,30,0.6); backdrop-filter: blur(4px);
    }
    .modal-content {
      width: 100%; max-width: 420px; max-height: 90vh;
      overflow-y: auto; scrollbar-width: none; background: var(--surface-page, #F5F7FA);
      border-radius: 16px; padding: 32px 24px 24px;
      border: 1px solid var(--surface-card, #FFF);
      opacity: 0; transform: translateY(24px);
      &.enter { animation: fadeIn 0.4s ease-out forwards; }
      &::-webkit-scrollbar { display: none; }
    }
    @keyframes fadeIn { to { opacity: 1; transform: translateY(0); } }

    .modal-header { text-align: center; margin-bottom: 24px; }

    .icon-wrapper {
      display: inline-flex; align-items: center; justify-content: center;
      width: 64px; height: 64px; border-radius: 50%;
      background: var(--primary-color);
      margin-bottom: 16px; opacity: 0; transform: scale(0.5);
      ion-icon { font-size: 32px; color: #fff; }
      &.icon-enter { animation: pop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.15s forwards; }
    }
    @keyframes pop { to { opacity: 1; transform: scale(1); } }
    .modal-header h2 { font-size: 1.35rem; font-weight: 700; color: var(--text-primary, #1A1A2E); margin: 0 0 6px; }
    .subtitle { font-size: 0.9rem; color: var(--text-secondary, #6B7280); margin: 0; line-height: 1.4; }

    .credential-card {
      background: var(--surface-card, #FFF); border-radius: 8px;
      border: 1px solid var(--border-default, #D1D5DB);
      box-shadow: 0 4px 6px rgba(0,0,0,0.07);
      padding: 20px; margin-bottom: 20px;
      opacity: 0; transform: scale(0.95) translateY(12px);
      &.card-enter { animation: reveal 0.5s ease-out 0.25s forwards; }
    }
    @keyframes reveal { to { opacity: 1; transform: scale(1) translateY(0); } }

    .card-header {
      display: flex; align-items: center;
      justify-content: space-between;
      gap: 10px; flex-wrap: wrap;
    }
    .credential-name { font-size: 1.05rem; font-weight: 600; color: var(--text-primary); }
    .format-badge {
      font-size: 0.65rem; font-weight: 700; text-transform: uppercase;
      padding: 3px 8px; border-radius: 4px;
      background: var(--primary-color); color: #fff;
    }
    .card-divider { height: 1px; background: var(--border-default, #D1D5DB); margin: 14px 0; opacity: 0.6; }

    .card-sections { display: flex; flex-direction: column; gap: 16px; }
    .section-block { display: flex; flex-direction: column; gap: 8px; }
    .section-title {
      font-size: 0.8rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.05em; color: var(--text-primary);
      padding-bottom: 4px; border-bottom: 1px solid var(--border-default, #D1D5DB);
    }
    .section-fields { display: flex; flex-direction: column; gap: 8px; }
    .field-row { display: flex; flex-direction: column; gap: 2px; }
    .field-label {
      font-size: 0.75rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.03em;
      color: var(--text-secondary, #6B7280);
    }
    .field-value {
      font-size: 0.9rem; color: var(--text-primary, #1A1A2E);
      line-height: 1.4; word-break: break-word;
    }

    .structured-list { display: flex; flex-direction: column; gap: 6px; margin-top: 4px; }
    .structured-item {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 8px 10px; background: var(--surface-muted, #E8ECF1); border-radius: 4px;
    }
    .structured-entry { display: inline-flex; gap: 4px; font-size: 0.85rem; }
    .structured-key { color: var(--text-secondary); font-weight: 500; }
    .structured-key::after { content: ':'; }
    .structured-val { color: var(--text-primary); }

    .expiration-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.85rem; color: var(--text-secondary, #6B7280);
      ion-icon { font-size: 18px; flex-shrink: 0; }
    }

    .countdown-section { margin-bottom: 20px; text-align: center; }
    .countdown-bar-track { height: 4px; border-radius: 2px; background: var(--surface-muted, #E8ECF1); overflow: hidden; margin-bottom: 8px; }
    .countdown-bar-fill { height: 100%; border-radius: 2px; background: var(--primary-color); transition: width 1s linear; }
    .countdown-text { font-size: 0.8rem; color: var(--text-secondary); }

    .modal-actions { display: flex; gap: 12px; }
    .btn {
      flex: 1; padding: 14px 20px; border-radius: 8px;
      font-size: 0.95rem; font-weight: 600;
      cursor: pointer; border: none; outline: none;
      transition: background 0.2s, transform 0.1s;
      &:active { transform: scale(0.97); }
    }
    .btn-outline {
      background: var(--surface-card, #FFF); color: #374151;
      border: 1px solid var(--border-default, #D1D5DB);
    }
    .btn-primary { background: var(--action-primary); color: #fff; }
  `],
})
export class CredentialConfirmationModalComponent {

  @Input() preview!: CredentialPreview;
  @Input() timeoutSeconds = 80;

  animateIn = false;
  remainingSeconds = 0;
  formattedExpiration = '';
  formatLabel = '';

  private interval: ReturnType<typeof setInterval> | undefined;

  constructor(
    private modalCtrl: ModalController,
    private translate: TranslateService,
  ) {}

  get countdownPercent(): number {
    if (this.timeoutSeconds <= 0) return 0;
    return (this.remainingSeconds / this.timeoutSeconds) * 100;
  }

  ionViewDidEnter(): void {
    this.animateIn = true;
    this.formatLabel = this.resolveFormatLabel(this.preview.format);
    this.formattedExpiration = this.formatDate(this.preview.expirationDate);
    this.remainingSeconds = this.timeoutSeconds;
    this.startCountdown();
  }

  ionViewWillLeave(): void {
    this.clearCountdown();
  }

  onAccept(): void {
    this.clearCountdown();
    this.modalCtrl.dismiss(null, 'confirm');
  }

  onReject(): void {
    this.clearCountdown();
    this.modalCtrl.dismiss(null, 'cancel');
  }

  private resolveFormatLabel(format: string): string {
    if (!format) return '';
    const lower = format.toLowerCase();
    if (lower.includes('sd-jwt') || lower.includes('sd_jwt') || lower.includes('vc+sd-jwt')) return 'SD-JWT';
    if (lower.includes('jwt') || lower.includes('jwt_vc')) return 'JWT';
    return format.toUpperCase();
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(this.translate.currentLang || 'es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
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