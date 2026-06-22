import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { HybridAdapterErrorCode } from 'src/app/core/models/error/HybridAdapterError';

/**
 * Displays error UX for hybrid adapter failures during signing (US-06, EUDISTACK-538).
 *
 * Usage: embed in any component that triggers hybrid signing and catch
 * HybridAdapterError, then bind its code to [errorCode].
 *
 * The full signing flow (prepareSign → PRF unwrap → submit) is wired in US-04.
 */
@Component({
  selector: 'app-sign-prompt',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './sign-prompt.component.html',
  styleUrl: './sign-prompt.component.scss',
})
export class SignPromptComponent {
  @Input() errorCode: HybridAdapterErrorCode | null = null;
  @Output() dismissed = new EventEmitter<void>();

  readonly WRAP_UNAVAILABLE: HybridAdapterErrorCode = 'wrap_unavailable_on_this_device';

  dismiss(): void {
    this.dismissed.emit();
  }
}
