import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './confirm-modal.component.html',
  styleUrls: ['./confirm-modal.component.scss'],
})
export class ConfirmModalComponent {
  @Input() icon = 'help-circle-outline';
  @Input() titleKey!: string;
  @Input() descriptionKey!: string;
  @Input() cancelKey!: string;
  @Input() actionKey!: string;
  @Input() actionVariant: 'primary' | 'danger' = 'primary';

  private readonly modalCtrl = inject(ModalController);

  onCancel(): void {
    this.modalCtrl.dismiss(null, 'cancel');
  }

  onConfirm(): void {
    this.modalCtrl.dismiss(null, 'confirm');
  }
}
