import { inject, Injectable } from '@angular/core';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { CredentialPreview } from '../models/credential-preview';
import { CredentialConfirmationModalComponent } from '../../shared/components/credential-confirmation-modal/credential-confirmation-modal.component';

export type DecisionResult = 'ACCEPTED' | 'REJECTED' | 'TIMEOUT';

@Injectable({ providedIn: 'root' })
export class CredentialDecisionService {

  private readonly modalController = inject(ModalController);
  private readonly translate = inject(TranslateService);

  async showDecisionDialog(preview: CredentialPreview, timeoutSeconds = 80): Promise<DecisionResult> {
    const modal = await this.modalController.create({
      component: CredentialConfirmationModalComponent,
      componentProps: { preview, timeoutSeconds },
      backdropDismiss: false,
      showBackdrop: false,
      cssClass: 'credential-confirmation-modal',
    });

    await modal.present();

    const { role } = await modal.onDidDismiss();

    if (role === 'confirm') return 'ACCEPTED';
    if (role === 'cancel') return 'REJECTED';
    return 'TIMEOUT';
  }

  async showTempMessage(translationKey: string, variant: 'success' | 'error' = 'success'): Promise<void> {
    const text = this.translate.instant(translationKey);
    const isSuccess = variant === 'success';
    const iconName = isSuccess ? 'checkmark-circle' : 'close-circle';

    const el = document.createElement('div');
    el.className = 'credential-toast';
    el.setAttribute('data-variant', variant);
    el.innerHTML = `
      <ion-icon name="${iconName}"></ion-icon>
      <span>${this.escapeHtml(text)}</span>
    `;

    document.body.appendChild(el);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => el.classList.add('visible'));

    setTimeout(() => {
      el.classList.remove('visible');
      el.classList.add('exiting');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      // Fallback removal
      setTimeout(() => el.remove(), 500);
    }, 2500);
  }

  private escapeHtml(value: string): string {
    const s = String(value ?? '');
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
