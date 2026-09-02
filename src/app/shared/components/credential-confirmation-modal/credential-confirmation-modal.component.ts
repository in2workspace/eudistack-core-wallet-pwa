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
    <!--
      EUD-142 (AD-4): credential-content shielding against the browser's page translation.
      Uses [attr.translate]="'no'" rather than the plain \`translate="no"\` HTML attribute:
      @ngx-translate's TranslateDirective selector is \`[translate]\` and would otherwise hijack
      this attribute, treating "no" as an i18n key instead of the platform's translate mode.
      See Tech Debt ticket referenced in technical-design.md §3.2 gap note.
    -->
    <ion-header class="drawer-topbar">
          <button
            type="button"
            class="drawer-close"
            (click)="onReject()"
            [attr.aria-label]="'confirmation.decline' | translate"
          >
            <ion-icon name="close-outline" aria-hidden="true"></ion-icon>
          </button>

          <h2>{{ 'confirmation.new-credential-title' | translate }}</h2>

          <div class="countdown-section" *ngIf="remainingSeconds > 0">
            <div class="countdown-bar-track">
              <div class="countdown-bar-fill" [style.width.%]="countdownPercent"></div>
            </div>
            <span class="countdown-text">
              {{ 'confirmation.review-within' | translate: { time: formattedRemaining } }}
            </span>
          </div>
    </ion-header>

    <ion-content class="drawer-body modal-content" [attr.translate]="'no'">
      <div class="credential-head">
            <span class="credential-name" [attr.translate]="'no'">{{ preview.displayName }}</span>
            <span class="format-badge" *ngIf="preview.format">{{ formatLabel }}</span>
          </div>

          <section class="section-block" *ngFor="let section of preview.sections">
            <h3 class="section-title" [attr.translate]="'no'">{{ section.section }}</h3>
            <div class="section-fields">
              <ng-container *ngFor="let field of section.fields">
                <!-- Structured field (array of objects like powers) -->
                <div class="field-row field-row--structured" *ngIf="field.structured?.length; else simpleField">
                  <span class="field-label" [attr.translate]="'no'">{{ field.label }}</span>
                  <div class="structured-list">
                    <div class="structured-item" *ngFor="let item of field.structured">
                      <span class="structured-entry">
                        <span class="structured-key" [attr.translate]="'no'">{{ item.label }}</span>
                        <span class="structured-val" [attr.translate]="'no'">{{ item.value }}</span>
                      </span>
                    </div>
                  </div>
                </div>
                <!-- Simple text field -->
                <ng-template #simpleField>
                  <div class="field-row">
                    <span class="field-label" [attr.translate]="'no'">{{ field.label }}</span>
                    <span class="field-value" [attr.translate]="'no'">{{ field.value }}</span>
                  </div>
                </ng-template>
              </ng-container>
            </div>
          </section>

      <div class="expiration-row" *ngIf="preview.expirationDate">
        <ion-icon name="calendar-outline" aria-hidden="true"></ion-icon>
        <span>{{ 'confirmation.expiration' | translate }}{{ formattedExpiration }}</span>
      </div>
    </ion-content>

    <ion-footer class="drawer-footer">
      <button type="button" class="btn btn-link" (click)="onReject()">
        {{ 'confirmation.decline' | translate }}
      </button>
      <button type="button" class="btn btn-primary" (click)="onAccept()">
        {{ 'confirmation.accept-credential' | translate }}
      </button>
    </ion-footer>
  `,
  styles: [`
    .drawer-topbar {
      position: relative;
      padding: 20px 24px 16px;
      text-align: center;
      background: var(--surface-card, #FFF);
      border-bottom: 1px solid var(--border-default, #D1D5DB);

      &::after { display: none; }
    }

    .drawer-close {
      position: absolute;
      top: 12px;
      right: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px; height: 32px;
      border: 0; background: none; cursor: pointer;
      color: var(--text-primary, #1A1A2E);
      ion-icon { font-size: 22px; }
    }

    .drawer-topbar h2 {
      margin: 0;
      padding-inline: 36px;
      font-size: 18px;
      font-weight: 700;
      line-height: 1.3;
      color: var(--text-primary, #1A1A2E);
    }

    .countdown-section { margin-top: 12px; }
    .countdown-bar-track {
      height: 4px; border-radius: 2px;
      background: var(--surface-muted, #E8ECF1);
      overflow: hidden; margin-bottom: 6px;
    }
    .countdown-bar-fill {
      height: 100%; border-radius: 2px;
      background: var(--status-success, #059669);
      transition: width 1s linear;
    }
    .countdown-text { font-size: 12px; color: var(--text-secondary, #6B7280); }

    /* ── Body ────────────────────────────────────────── */

    .drawer-body {
      --background: var(--surface-card, #FFF);
      --padding-start: 24px;
      --padding-end: 24px;
      --padding-top: 20px;
      --padding-bottom: 20px;
    }

    .credential-head {
      display: flex; align-items: center;
      justify-content: space-between; gap: 10px; flex-wrap: wrap;
      margin-bottom: 20px;
    }
    .credential-name { font-size: 17px; font-weight: 700; color: var(--text-primary); }
    .format-badge {
      font-size: 11px; font-weight: 600; text-transform: uppercase;
      padding: 3px 8px; border-radius: 6px;
      background: var(--surface-muted, #E8ECF1); color: var(--text-primary);
    }

    .section-block { margin-bottom: 22px; }
    .section-title {
      margin: 0 0 10px;
      font-size: 15px; font-weight: 700;
      color: var(--text-primary);
    }

    .section-fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px 16px;
    }
    .field-row { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .field-label {
      font-size: 12px; font-weight: 600;
      color: var(--text-secondary, #6B7280);
    }
    .field-value {
      padding: 9px 12px;
      border: 1px solid var(--border-default, #D1D5DB);
      border-radius: 8px;
      background: var(--surface-muted, #E8ECF1);
      font-size: 14px; color: var(--text-primary, #1A1A2E);
      line-height: 1.35; word-break: break-word;
    }

    .field-row--structured {
      grid-column: 1 / -1;
      margin: 0 -24px;
      padding: 16px 24px;
      background: #C8D6F0;
    }

    .structured-list { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
    .structured-item {
      display: flex; flex-wrap: wrap; gap: 6px;
      padding: 9px 12px;
      border: 1px solid var(--border-default, #D1D5DB);
      border-radius: 8px;
      background: var(--surface-card, #FFF);
    }
    .structured-entry { display: inline-flex; gap: 4px; font-size: 14px; }
    .structured-key { color: var(--text-secondary); font-weight: 500; }
    .structured-key::after { content: ':'; }
    .structured-val { color: var(--text-primary); }

    .expiration-row {
      display: flex; align-items: center; gap: 8px;
      font-size: 13px; color: var(--text-secondary, #6B7280);
      ion-icon { font-size: 18px; flex-shrink: 0; }
    }

    /* ── Footer ──────────────────────────────────────── */

    .drawer-footer {
      display: flex; align-items: center; justify-content: center;
      gap: 12px;
      padding: 12px 24px;
      padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
      background: var(--surface-card, #FFF);
      border-top: 1px solid var(--border-default, #D1D5DB);

      &::before { display: none; }
    }
    .btn {
      flex: 1 1 0;
      min-width: 0;
      min-height: 44px; padding: 12px 20px;
      border-radius: 8px; border: none; outline: none;
      font: inherit; font-size: 15px; font-weight: 600;
      text-align: center;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      &:active { transform: scale(0.97); }
      &:focus-visible { outline: 2px solid var(--ui-focus-ring); outline-offset: 2px; }
    }
    .btn-link {
      background: transparent;
      color: var(--status-error, #DC2626);
    }
    .btn-primary {
      background: var(--primary-color);
      color: var(--primary-contrast-color);
    }

    @media (max-width: 767px) {
      .drawer-footer { flex-direction: column; }
      .btn { width: 100%; }
    }
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

  get formattedRemaining(): string {
    const total = Math.max(0, this.remainingSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${`${minutes}`.padStart(2, '0')}:${`${seconds}`.padStart(2, '0')}`;
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
