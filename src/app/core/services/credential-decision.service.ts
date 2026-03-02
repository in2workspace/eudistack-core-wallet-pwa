import { inject, Injectable } from '@angular/core';
import { AlertController, AlertOptions } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { CredentialPreview, Power } from '../models/credential-preview';

export type DecisionResult = 'ACCEPTED' | 'REJECTED' | 'TIMEOUT';

@Injectable({ providedIn: 'root' })
export class CredentialDecisionService {

  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);

  async showDecisionDialog(preview: CredentialPreview, timeoutSeconds = 80): Promise<DecisionResult> {
    return new Promise<DecisionResult>(async (resolve) => {
      let resolved = false;
      const doResolve = (result: DecisionResult) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      const previewHtml = this.buildPreviewHtml(preview);

      const header = this.translate.instant('confirmation.new-credential-title');
      const accept = this.translate.instant('confirmation.accept');
      const reject = this.translate.instant('confirmation.cancel');
      const baseDescription = this.translate.instant('confirmation.new-credential');

      const descriptionWithPreview = previewHtml
        ? `${baseDescription}<br/>${previewHtml}`
        : baseDescription;

      const message = this.translate.instant('confirmation.messageHtml', {
        description: descriptionWithPreview,
        counter: timeoutSeconds,
      });

      const alertOptions: AlertOptions = {
        header,
        message,
        buttons: [
          { text: reject, role: 'cancel', handler: () => doResolve('REJECTED') },
          { text: accept, role: 'confirm', handler: () => doResolve('ACCEPTED') },
        ],
        backdropDismiss: false,
      };

      const alert = await this.alertController.create(alertOptions);
      await alert.present();

      alert.onDidDismiss().then(() => {
        clearInterval(interval);
        doResolve('TIMEOUT');
      });

      const interval = this.startCountdown(alert, descriptionWithPreview, timeoutSeconds);
    });
  }

  async showTempMessage(translationKey: string): Promise<void> {
    const alert = await this.alertController.create({
      message: `
        <div style="display: flex; align-items: center; gap: 50px;">
          <ion-icon name="checkmark-circle-outline"></ion-icon>
          <span>${this.translate.instant(translationKey)}</span>
        </div>
      `,
      cssClass: 'custom-alert-ok',
    });

    await alert.present();
    setTimeout(() => alert.dismiss(), 3000);
  }

  private buildPreviewHtml(preview: CredentialPreview): string {
    if (!preview) return '';

    const subjectLabel = this.translate.instant('confirmation.holder');
    const organizationLabel = this.translate.instant('confirmation.organization');
    const powersLabel = this.translate.instant('confirmation.powers');
    const expirationLabel = this.translate.instant('confirmation.expiration');

    return `
      <div class="cred-preview">
        <div class="cred-row">
          <span class="cred-label"><strong>${subjectLabel}</strong>${this.escapeHtml(preview.subjectName)}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label"><strong>${organizationLabel}</strong>${this.escapeHtml(preview.organization)}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label"><strong>${powersLabel}</strong>${this.mapPowersToHumanReadable(preview.power)}</span>
        </div>
        <div class="cred-row">
          <span class="cred-label"><strong>${expirationLabel}</strong>${this.formatDateHuman(preview.expirationDate)}</span>
        </div>
      </div>
    `;
  }

  private startCountdown(alert: any, description: string, initialCounter: number): number {
    let counter = initialCounter;

    return window.setInterval(() => {
      if (counter > 0) {
        counter--;
        alert.message = this.translate.instant('confirmation.messageHtml', {
          description,
          counter,
        });
      } else {
        alert.dismiss();
      }
    }, 1000);
  }

  private mapPowersToHumanReadable(powers: Power[]): string {
    if (!powers || powers.length === 0) return '';

    const unknown = this.translate.instant('confirmation.unknown');

    return powers
      .map((p) => {
        const fnKey = this.normalizeKey(p?.function);
        const actionKeys = this.normalizeActionKeys(p?.action);

        const functionLabel = this.escapeHtml(
          this.getSafeTranslation(`vc-fields.power.${fnKey}`, p?.function, unknown)
        );

        const actionLabels = this.escapeHtml(
          actionKeys
            .map((a) => this.getSafeTranslation(`vc-fields.power.${a}`, a, unknown))
            .filter((x) => x && x !== unknown)
            .join(', ')
        );

        if (!functionLabel || !actionLabels) return '';
        return `${functionLabel}: ${actionLabels}`;
      })
      .filter(Boolean)
      .join('<br/>');
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

  private formatDateHuman(dateStr: string): string {
    const escaped = this.escapeHtml(dateStr);
    const date = new Date(escaped);
    return date.toLocaleDateString(this.translate.currentLang || 'es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  private escapeHtml(value: string): string {
    let s = String(value ?? '');
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1);
    }
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
