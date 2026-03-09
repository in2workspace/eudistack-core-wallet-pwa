import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CredentialPreview, Power } from '../../../core/models/credential-preview';

/** A field that has been processed for display. */
interface DisplayField {
  label: string;
  value: string;
  /** If the value was a JSON array of objects, each is flattened here. */
  structured: StructuredItem[] | null;
}

interface StructuredItem {
  entries: { key: string; value: string }[];
}

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

          <div class="card-fields">
            <ng-container *ngIf="displayFields.length; else legacyFields">
              <ng-container *ngFor="let field of displayFields">
                <!-- Structured field (array of objects like powers) -->
                <div class="field-row" *ngIf="field.structured; else simpleField">
                  <span class="field-label">{{ field.label }}</span>
                  <div class="structured-list">
                    <div class="structured-item" *ngFor="let item of field.structured">
                      <span *ngFor="let e of item.entries" class="structured-entry">
                        <span class="structured-key">{{ e.key }}</span>
                        <span class="structured-val">{{ e.value }}</span>
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
            </ng-container>

            <ng-template #legacyFields>
              <div class="field-row" *ngIf="preview.subjectName">
                <span class="field-label">{{ 'confirmation.holder' | translate }}</span>
                <span class="field-value">{{ preview.subjectName }}</span>
              </div>
              <div class="field-row" *ngIf="preview.organization">
                <span class="field-label">{{ 'confirmation.organization' | translate }}</span>
                <span class="field-value">{{ preview.organization }}</span>
              </div>
              <div class="field-row" *ngIf="preview.power?.length">
                <span class="field-label">{{ 'confirmation.powers' | translate }}</span>
                <div class="structured-list">
                  <div class="structured-item" *ngFor="let entry of mappedPowers">
                    <span class="structured-entry">
                      <span class="structured-key">{{ entry.fn }}</span>
                      <span class="structured-val">{{ entry.actions }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </ng-template>
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
      overflow-y: auto; background: var(--surface-page, #F5F7FA);
      border-radius: 16px; padding: 32px 24px 24px;
      opacity: 0; transform: translateY(24px);
      &.enter { animation: fadeIn 0.4s ease-out forwards; }
    }
    @keyframes fadeIn { to { opacity: 1; transform: translateY(0); } }

    .modal-header { text-align: center; margin-bottom: 24px; }

    .icon-wrapper {
      display: inline-flex; align-items: center; justify-content: center;
      width: 64px; height: 64px; border-radius: 50%;
      background: var(--action-primary, #2563EB);
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
      background: var(--action-primary, #2563EB); color: #fff;
    }
    .card-divider { height: 1px; background: var(--border-default, #D1D5DB); margin: 14px 0; opacity: 0.6; }

    .card-fields { display: flex; flex-direction: column; gap: 12px; }
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
    .countdown-bar-fill { height: 100%; border-radius: 2px; background: var(--action-primary, #2563EB); transition: width 1s linear; }
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
    .btn-primary { background: var(--action-primary, #2563EB); color: #fff; }
  `],
})
export class CredentialConfirmationModalComponent {

  @Input() preview!: CredentialPreview;
  @Input() timeoutSeconds = 80;

  animateIn = false;
  remainingSeconds = 0;
  displayFields: DisplayField[] = [];
  mappedPowers: { fn: string; actions: string }[] = [];
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
    this.displayFields = this.buildDisplayFields(this.preview);
    this.mappedPowers = this.buildLegacyPowers(this.preview.power);
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

  /**
   * Processes preview fields. If a field value is a JSON array of objects,
   * it gets parsed into structured items for nice rendering.
   */
  private buildDisplayFields(preview: CredentialPreview): DisplayField[] {
    if (!preview.fields?.length) return [];

    return preview.fields.map(field => {
      const structured = this.tryParseStructured(field.value);
      return { label: field.label, value: structured ? '' : field.value, structured };
    });
  }

  /**
   * Agnostic parser: detects JSON arrays of objects or single objects in a string
   * and flattens them into key-value pairs for display.
   */
  private tryParseStructured(value: string): StructuredItem[] | null {
    if (!value) return null;
    const trimmed = value.trim();
    // Only try if it looks like JSON array or object
    if (!(trimmed.startsWith('[') || trimmed.startsWith('{'))) return null;

    try {
      let parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) parsed = [parsed];
      if (!parsed.length || typeof parsed[0] !== 'object') return null;

      return parsed.map((obj: Record<string, unknown>) => ({
        entries: this.flattenObject(obj),
      }));
    } catch {
      return null;
    }
  }

  /**
   * Flattens an object into key-value string pairs, filtering out
   * keys like 'type' that are meta and making values human-readable.
   */
  private flattenObject(obj: Record<string, unknown>): { key: string; value: string }[] {
    const skipKeys = new Set(['type', 'id', '@type', '@context']);
    return Object.entries(obj)
      .filter(([k, v]) => !skipKeys.has(k) && v != null && v !== '')
      .map(([k, v]) => ({
        key: this.humanizeKey(k),
        value: this.humanizeValue(v),
      }));
  }

  /** Converts camelCase/snake_case keys to readable labels. */
  private humanizeKey(key: string): string {
    return key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[_-]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /** Converts a value to a display string, joining arrays with commas. */
  private humanizeValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(v => this.humanizeValue(v)).join(', ');
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value ?? '');
  }

  private buildLegacyPowers(powers: Power[]): { fn: string; actions: string }[] {
    if (!powers?.length) return [];

    const unknown = this.translate.instant('confirmation.unknown');

    return powers
      .map((p) => {
        const fnKey = this.normalizeKey(p?.function);
        const actionKeys = this.normalizeActionKeys(p?.action);

        const fn = this.getSafeTranslation(`vc-fields.power.${fnKey}`, p?.function, unknown);
        const actions = actionKeys
          .map((a) => this.getSafeTranslation(`vc-fields.power.${a}`, a, unknown))
          .filter((x) => x && x !== unknown)
          .join(', ');

        if (!fn || !actions) return null;
        return { fn, actions };
      })
      .filter((x): x is { fn: string; actions: string } => x !== null);
  }

  private getSafeTranslation(key: string, fallbackText: unknown, unknown: string): string {
    const translated = this.translate.instant(key);
    if (translated && translated !== key) return String(translated);
    const fb = String(fallbackText ?? '').trim();
    const looksLikeKey = fb.includes('.') || fb.includes('_') || fb.includes('-');
    if (!fb || looksLikeKey) return unknown;
    return fb;
  }

  private normalizeKey(value: unknown): string {
    return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  private normalizeActionKeys(actions: unknown): string[] {
    if (!Array.isArray(actions)) return [];
    return actions.map((a) => this.normalizeKey(a)).filter(Boolean);
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
