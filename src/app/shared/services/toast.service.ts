import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { map, Observable, take } from 'rxjs';
import { AlertController, ToastController } from '@ionic/angular';

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
  private readonly toastController = inject(ToastController);

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
   * and retry. Anchored to the top so it doesn't sit over the scanner view.
   */
  public showInfoToastByTranslateLabel(message: string, duration: number = 6000): void {
    this.translate.get(message).pipe(take(1)).subscribe(async (translatedMessage) => {
      const toast = await this.toastController.create({
        message: translatedMessage,
        duration,
        color: 'warning',
        position: 'top',
        buttons: [{ text: this.translate.instant('vc-selector.close'), role: 'cancel' }],
      });
      await toast.present();
    });
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