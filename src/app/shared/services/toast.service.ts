import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Observable, from, switchMap, take } from 'rxjs';
import { ModalController } from '@ionic/angular';
import { AlertDialogComponent, AlertDialogVariant } from '../components/alert-dialog/alert-dialog.component';

/** The notices are an ion-modal with this class (size and backdrop in customAlert.scss). */
const ALERT_MODAL_CSS_CLASS = 'app-alert-modal';

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
  private readonly modalController = inject(ModalController);

  /**
   * @param fallbackKey translation used when `message` matches no known backend
   * message — callers that know the cause (e.g. the HTTP status) pass a specific
   * key so the user is not shown the generic "something went wrong" text.
   */
  public showErrorAlert(message: string, fallbackKey: string = 'errors.default'): Observable<unknown> {
    const translationKey = Object.keys(ERROR_TRANSLATION_MAP)
      .find(prefix => message.startsWith(prefix));
    const messageBody = translationKey
      ? ERROR_TRANSLATION_MAP[translationKey]
      : fallbackKey;

    return this.showErrorAlertByTranslateLabel(messageBody);
  }

  public showErrorAlertByTranslateLabel(message: string): Observable<void> {
    return this.showAlertByTranslateLabel(message, 'error');
  }

  /** Blocking alert with informative styling, for expected events that are not failures. */
  public showInfoAlertByTranslateLabel(message: string): Observable<void> {
    return this.showAlertByTranslateLabel(message, 'info');
  }

  private showAlertByTranslateLabel(message: string, variant: AlertDialogVariant): Observable<void> {
    return this.translate.get(message).pipe(
      take(1),
      // switchMap + from(promise), not map(async ...): map would emit the
      // pending Promise itself and complete immediately, so subscribers
      // reacting on completion (e.g. resuming the QR scanner) would fire
      // before the alert was even shown, instead of after it's dismissed.
      switchMap((translatedMessage) => from(this.presentAlert(translatedMessage, variant))),
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
    variant: 'info' | 'warning' = 'info',
    interpolateParams?: Record<string, unknown>
  ): void {
    const icon = variant === 'warning' ? 'warning' : 'information-circle';
    this.translate.get(message, interpolateParams).pipe(take(1)).subscribe((translatedMessage) => {
      const el = document.createElement('div');
      el.className = 'credential-toast';
      el.dataset['variant'] = variant;
      // Built with DOM nodes and textContent, never innerHTML (EUD-332): the message is text.
      const iconEl = document.createElement('ion-icon');
      iconEl.setAttribute('name', icon);
      const textEl = document.createElement('span');
      textEl.textContent = String(translatedMessage ?? '');
      el.append(iconEl, textEl);

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
   * The message is passed as text to AlertDialogComponent, which renders the
   * support link from its {{supportLink}} placeholder itself: no HTML is built here.
   */
  private async presentAlert(translatedMessage: string, variant: AlertDialogVariant): Promise<void> {
    const alert = await this.modalController.create({
      component: AlertDialogComponent,
      componentProps: {
        message: String(translatedMessage ?? ''),
        variant,
        closeLabel: this.translate.instant('vc-selector.close'),
      },
      cssClass: ALERT_MODAL_CSS_CLASS,
    });

    await alert.present();
    await alert.onDidDismiss();
  }

  public showToast(messageKey: string, duration: number = 2000): void {
    this.modalController.create({
      component: AlertDialogComponent,
      componentProps: {
        message: String(this.translate.instant(messageKey) ?? ''),
        variant: 'success',
      },
      cssClass: ALERT_MODAL_CSS_CLASS,
    })
      .then(alert => alert.present().then(() => {
        setTimeout(() => {
          void alert.dismiss();
        }, duration);
      }))
      .catch(err => console.error('ToastService: failed to show toast', err));
  }



}
