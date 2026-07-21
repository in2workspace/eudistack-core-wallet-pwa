import { Component, computed, inject, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ActivityEntry, ActivityType } from 'src/app/core/models/activity.model';
import { formatAbsoluteTime, formatCounterparty } from 'src/app/shared/utils/activity-format.util';

const KNOWN_TYPES: ActivityType[] = ['issued', 'presented', 'deleted'];

const COUNTERPARTY_LABEL_KEYS: Partial<Record<ActivityType, string>> = {
  issued: 'activity.detail-field-counterparty-issued',
  presented: 'activity.detail-field-counterparty-presented',
};

/**
 * Read-only detail view for a single activity entry (AD-1: presented as an
 * Ionic modal, mirroring ConfirmModalComponent's componentProps pattern).
 * No write actions are exposed (AC-04) — closing is the only interaction.
 */
@Component({
  selector: 'app-activity-detail',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './activity-detail.component.html',
  styleUrls: ['./activity-detail.component.scss'],
})
export class ActivityDetailComponent {
  readonly entry = input.required<ActivityEntry>();

  private readonly modalCtrl = inject(ModalController);

  readonly typeLabelKey = computed(() =>
    KNOWN_TYPES.includes(this.entry().type) ? `activity.type-${this.entry().type}` : 'activity.type-unknown'
  );

  readonly counterpartyLabelKey = computed(() => COUNTERPARTY_LABEL_KEYS[this.entry().type] ?? null);

  readonly counterpartyValue = computed(() => formatCounterparty(this.entry()));

  readonly showCounterparty = computed(() => this.counterpartyLabelKey() !== null && this.counterpartyValue() !== '');

  readonly showDetails = computed(() => !!this.entry().details?.trim());

  readonly absoluteDate = computed(() => formatAbsoluteTime(this.entry().timestamp));

  readonly showSharedAttributes = computed(() => this.entry().type === 'presented');

  readonly sharedAttributes = computed(() => this.entry().sharedAttributes ?? []);

  close(): void {
    this.modalCtrl.dismiss(null, 'close');
  }
}
