import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { SupportMessageComponent } from '../support-message/support-message.component';

export type AlertDialogVariant = 'error' | 'info' | 'success';

/**
 * Body of the app's notice dialogs (ToastServiceHandler), shown in an ion-modal.
 * Replaces the ion-alert whose message was built as HTML: with Ionic's
 * innerHTMLTemplatesEnabled off (EUD-332), an ion-alert message is plain text and
 * can carry neither the support link nor the success icon. The message is
 * rendered as text by SupportMessageComponent.
 */
@Component({
  selector: 'app-alert-dialog',
  imports: [IonicModule, SupportMessageComponent],
  templateUrl: './alert-dialog.component.html',
  styleUrls: ['./alert-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertDialogComponent {
  private readonly modalController = inject(ModalController);

  /** The message, already translated. */
  public readonly message = input('');
  public readonly variant = input<AlertDialogVariant>('error');
  /** Label of the close button; without it the dialog has no button (auto-dismissed notices). */
  public readonly closeLabel = input<string | undefined>(undefined);

  public close(): void {
    void this.modalController.dismiss(undefined, 'ok');
  }
}
