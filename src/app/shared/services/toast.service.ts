import { Injectable, SecurityContext, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Observable, from, switchMap, take } from 'rxjs';
import { AlertController } from '@ionic/angular';
import { DomSanitizer } from '@angular/platform-browser';

/**
 * Fixed destination for the "contact support" link embedded in some error
 * messages. Kept out of the translated strings themselves — see
 * SUPPORT_LINK_PLACEHOLDER.
 */
const SUPPORT_URL = 'https://ticketing.dome-marketplace.eu/';

/**
 * Token a translated message can contain to ask for the support link to be
 * inlined. Swapped for a real anchor tag *after* escaping (see
 * `renderMessage`), so the anchor itself — built in code, not translator
 * content — is the only markup that ever reaches the DOM. Translator-authored
 * prose stays escaped, preserving the EUD-142 (F2) XSS hardening.
 */
const SUPPORT_LINK_PLACEHOLDER = '{{supportLink}}';

const ERROR_TRANSLATION_MAP: Record<string, string> = {
  'The received QR content cannot be processed': 'errors.invalid-qr',
  'There are no credentials available to login': 'errors.no-credentials-available',
  'There was a problem processing the QR. It might be invalid or already have been used': 'errors.failed-qr-process',
  'Error while fetching credentialOffer from the issuer': 'errors.expired-credentialOffer',
  'Credential offer not found': 'errors.expired-credentialOffer',
  'Error while deserializing CredentialOffer': 'errors.invalid-credentialOffer',
  'Error while processing Credential Issuer Metadata from the Issuer': 'errors.invalid-issuerMetadata',
  'Error while fetching  Credential from Issuer': 'errors.cannot-get-VC',
  'Error processing Verifiable Credential': 'errors.cannot-save-VC',
  'Incorrect PIN': 'errors.incorrect-pin',
  'Unsigned': 'errors.unsigned',
  'ErrorUnsigned': 'errors.Errunsigned',
  'PIN expired': 'errors.pin-expired',
  'The QR session expired': 'errors.qr-expired',
};

@Injectable({
  providedIn: 'root',
})
export class ToastServiceHandler {
  private readonly translate = inject(TranslateService);
  private readonly alertController = inject(AlertController);
  private readonly sanitizer = inject(DomSanitizer);

  public showErrorAlert(message: string): Observable<unknown> {
    const translationKey = Object.keys(ERROR_TRANSLATION_MAP)
      .find(prefix => message.startsWith(prefix));
    const messageBody = translationKey
      ? ERROR_TRANSLATION_MAP[translationKey]
      : 'errors.default';

    return this.showErrorAlertByTranslateLabel(messageBody);
  }

  public showErrorAlertByTranslateLabel(message: string): Observable<void> {
    return this.translate.get(message).pipe(
      take(1),
      // switchMap + from(promise), not map(async ...): map would emit the
      // pending Promise itself and complete immediately, so subscribers
      // reacting on completion (e.g. resuming the QR scanner) would fire
      // before the alert was even shown, instead of after it's dismissed.
      switchMap((translatedMessage) => from(this.presentErrorAlert(translatedMessage))),
    );
  }

  /**
   * Non-blocking, non-alarming notice for user-recoverable situations (e.g.
   * camera permission denied) — a centered red modal alert makes it look
   * like something crashed, when the user just needs to grant a permission
   * and retry.
   *
   * Reuses the .credential-toast pattern (a plain div, not an ion-toast):
   * ion-toast::part(container) is force-styled app-wide (customAlert.scss),
   * which fought any color/background passed through Ionic's ToastController
   * and rendered the message invisible (white text on the forced white card
   * background). The plain div sidesteps that entirely and is already
   * compact/centered by design — no full-width banner.
   */
  public showInfoToastByTranslateLabel(
    message: string,
    durationMs: number = 5000,
    variant: 'info' | 'warning' = 'info'
  ): void {
    const icon = variant === 'warning' ? 'warning' : 'information-circle';
    this.translate.get(message).pipe(take(1)).subscribe((translatedMessage) => {
      const el = document.createElement('div');
      el.className = 'credential-toast';
      el.dataset['variant'] = variant;
      el.innerHTML = `
        <ion-icon name="${icon}"></ion-icon>
        <span>${this.sanitizeHtml(translatedMessage)}</span>
      `;

      document.body.appendChild(el);

      requestAnimationFrame(() => el.classList.add('visible'));

      setTimeout(() => {
        el.classList.remove('visible');
        el.classList.add('exiting');
        el.addEventListener('animationend', () => el.remove(), { once: true });
        setTimeout(() => el.remove(), 500);
      }, durationMs);
    });
  }

  /**
   * Sanitizes the translated message (stripping scripts/event handlers/unsafe
   * URLs but keeping safe markup — DomSanitizer, same primitive as the rest
   * of this file), then — only if present — swaps SUPPORT_LINK_PLACEHOLDER
   * for a real anchor. href/target/rel and the anchor's own label translation
   * are all code-controlled, so the placeholder can only ever resolve to the
   * one fixed support URL, regardless of what a translation string contains.
   */
  private renderMessage(translatedMessage: string): string {
    const sanitized = this.sanitizeHtml(translatedMessage);
    if (!sanitized.includes(SUPPORT_LINK_PLACEHOLDER)) {
      return sanitized;
    }

    const label = this.sanitizeHtml(this.translate.instant('errors.support-team-label'));
    const link = `<a href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer">${label}</a>`;

    return sanitized.split(SUPPORT_LINK_PLACEHOLDER).join(link);
  }

  private sanitizeHtml(value: string): string {
    return this.sanitizer.sanitize(SecurityContext.HTML, String(value ?? '')) ?? '';
  }

  private async presentErrorAlert(translatedMessage: string): Promise<void> {
    const alert = await this.alertController.create({
      message: `
        <div style="display: flex; align-items: center; gap: 50px;">
          <span>${this.renderMessage(translatedMessage)}</span>
        </div>
      `,
      buttons: [
        {
          text: this.translate.instant('vc-selector.close'),
          role: 'ok',
          cssClass: 'centered-button',
        },
      ],
      cssClass: 'custom-alert-error',
    });

    await alert.present();
    await alert.onDidDismiss();
  }

  public showToast(messageKey: string, duration: number = 2000): void {
    this.alertController.create({
      message: `
        <div style="display: flex; align-items: center; gap: 50px;">
          <ion-icon name="checkmark-circle"></ion-icon>
          <span>${this.sanitizeHtml(this.translate.instant(messageKey))}</span>
        </div>
      `,
      cssClass: 'custom-alert-ok',
    }).then(alert => {
      alert.present().then(() => {
        setTimeout(() => {
          alert.dismiss();
        }, duration);
      });
    });
  }



}
