import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';

/**
 * Token a translated message can contain to ask for the support link to be inlined
 * (errors.default, errors.pin-expired...).
 */
export const SUPPORT_LINK_PLACEHOLDER = '{{supportLink}}';

/**
 * Shows a translated message as text, with the support link in place of each
 * SUPPORT_LINK_PLACEHOLDER. Nothing is inserted as HTML (EUD-332, SEC-26): the
 * message is interpolated as text and the link is part of this template, so its
 * href, target and rel are code-controlled and its destination is the
 * tenant-resolved support URL (SupportChannelService.supportUrl, EC-07/AD-4),
 * never something a translation or a parameter contains.
 */
@Component({
  selector: 'app-support-message',
  imports: [TranslateModule],
  template: `@for (part of parts(); track $index) {@if (!$first) {<a [href]="supportUrl()" target="_blank" rel="noopener noreferrer">{{ 'errors.support-team-label' | translate }}</a>}{{ part }}}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportMessageComponent {
  private readonly supportChannel = inject(SupportChannelService);

  /** The message, already translated. */
  public readonly message = input<string | null | undefined>('');

  protected readonly parts = computed(() => String(this.message() ?? '').split(SUPPORT_LINK_PLACEHOLDER));
  protected readonly supportUrl = computed(() => this.supportChannel.channels().supportUrl);
}
