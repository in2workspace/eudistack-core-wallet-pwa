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
              <ion-icon name="alert-circle-outline"></ion-icon>
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