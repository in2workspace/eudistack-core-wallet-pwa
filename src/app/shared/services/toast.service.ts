import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { map, Observable, take } from 'rxjs';
import { AlertController } from '@ionic/angular';

const ERROR_TRANSLATION_MAP: Record<string, string> = {
  'The received QR content cannot be processed': 'errors.invalid-qr',
  'There are no credentials available to login': 'errors.no-credentials-available',
  'There was a problem processing the QR. It might be invalid or already have been used': 'errors.failed-qr-process',
  'Error while fetching credentialOffer from the issuer': 'errors.expired-credentialOffer',
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

  public showErrorAlert(message: string): Observable<unknown> {
    const translationKey = Object.keys(ERROR_TRANSLATION_MAP)
      .find(prefix => message.startsWith(prefix));
    const messageBody = translationKey
      ? ERROR_TRANSLATION_MAP[translationKey]
      : 'errors.default';

    return this.showErrorAlertByTranslateLabel(messageBody);
  }

  public showErrorAlertByTranslateLabel(message: string){
    return this.translate.get(message).pipe(
      take(1),
      map(async (translatedMessage) => {
        const alert = await this.alertController.create({
          message: `
            <div style="display: flex; align-items: center; gap: 50px;">
              <span>${translatedMessage}</span>
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
      })
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
  public showWarningToastByTranslateLabel(message: string, durationMs: number = 5000): void {
    this.translate.get(message).pipe(take(1)).subscribe((translatedMessage) => {
      const el = document.createElement('div');
      el.className = 'credential-toast';
      el.setAttribute('data-variant', 'warning');
      el.innerHTML = `
        <ion-icon name="alert-circle"></ion-icon>
        <span>${this.escapeHtml(translatedMessage)}</span>
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

  private escapeHtml(value: string): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  public showToast(messageKey: string, duration: number = 2000): void {
    this.alertController.create({
      message: `
        <div style="display: flex; align-items: center; gap: 50px;">
          <ion-icon name="checkmark-circle"></ion-icon>
          <span>${this.translate.instant(messageKey)}</span>
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