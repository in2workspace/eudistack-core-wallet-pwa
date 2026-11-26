import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { SupportMessageComponent } from '../support-message/support-message.component';

export type AlertDialogVariant = 'error' | 'info' | 'success';

/**
 * Options for ModalController.create of a notice. Ionic copies `role` to the
 * modal's inner wrapper, which is a `dialog` without accessible name: `none`
 * leaves the semantics to AlertDialogComponent, whose container is the
 * `alertdialog` described by its message (the wrapper is in the modal's shadow
 * DOM, so its aria-describedby could not point to the message).
 */
export const ALERT_DIALOG_MODAL_ATTRIBUTES = { role: 'none' };

/**
 * Focus of a notice once presented, as ion-alert did: the button when there is
 * one, the notice itself otherwise.
 */
export function focusAlertDialog(modal: HTMLElement): void {
  const target = modal.querySelector<HTMLElement>('.alert-dialog__button')
    ?? modal.querySelector<HTMLElement>('.alert-dialog');
  target?.focus();
}

let nextId = 0;

/**
 * Body of the app's notice dialogs (ToastServiceHandler), shown in an ion-modal.
 * Replaces the ion-alert whose message was built as HTML: with Ionic's
 * innerHTMLTemplatesEnabled off (EUD-332), an ion-alert message is plain text and
 * can carry neither the support link nor the success icon. The message is
 * rendered as text by SupportMessageComponent.
 *
 * Accessibility, as the ion-alert it replaces: with a button the notice is an
 * `alertdialog` described by its message, and the button gets the focus
 * (focusAlertDialog); without a button (auto-dismissed notices) it is an `alert`.
 */
@Component({
  selector: 'app-alert-dialog',
  imports: [IonicModule, SupportMessageComponent],
  templateUrl: './alert-dialog.component.html',
  styleUrls: ['./alert-dialog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertDialogComponent {
  /** The message, already translated. */
  public readonly message = input('');
  public readonly variant = input<AlertDialogVariant>('error');
  /** Label of the close button; without it the dialog has no button (auto-dismissed notices). */
  public readonly closeLabel = input<string | undefined>(undefined);

  /** Id of the message, which describes the dialog. */
  protected readonly messageId = `alert-dialog-message-${nextId++}`;

  private readonly modalController = inject(ModalController);

  public close(): void {
    void this.modalController.dismiss(undefined, 'ok');
  }
}
