import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-manual-code-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, IonicModule, TranslateModule],
  templateUrl: './manual-code-modal.component.html',
  styleUrls: ['./manual-code-modal.component.scss'],
})
export class ManualCodeModalComponent {
  private readonly modalCtrl = inject(ModalController);

  readonly code = signal('');

  get trimmedCode(): string {
    return this.code().trim();
  }

  onInput(value: string): void {
    this.code.set(value);
  }

  cancel(): void {
    void this.modalCtrl.dismiss(null, 'cancel');
  }

  submit(): void {
    if (!this.trimmedCode) return;
    void this.modalCtrl.dismiss(this.trimmedCode, 'confirm');
  }
}
