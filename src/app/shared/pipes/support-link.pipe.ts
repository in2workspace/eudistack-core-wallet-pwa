import { Pipe, PipeTransform, inject } from '@angular/core';
import { ToastServiceHandler } from '../services/toast.service';

/**
 * Wraps `ToastServiceHandler.renderSupportMessage()` for templates that need
 * to bind a translated, support-link-bearing message straight to
 * `[innerHTML]` (e.g. an inline error state) instead of an `ion-alert`. Pure
 * by default, so chaining it after `translate` (`'key' | translate | supportLink`)
 * re-renders on a runtime language change for free.
 */
@Pipe({
  name: 'supportLink',
  standalone: true,
})
export class SupportLinkPipe implements PipeTransform {
  private readonly toastServiceHandler = inject(ToastServiceHandler);

  transform(translatedMessage: string): string {
    return this.toastServiceHandler.renderSupportMessage(translatedMessage);
  }
}
