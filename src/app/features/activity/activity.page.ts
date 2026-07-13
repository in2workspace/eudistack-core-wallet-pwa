import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ViewWillEnter } from '@ionic/angular';
import { SegmentValue } from '@ionic/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ACTIVITY_FILTERS, ActivityEntry, ActivityFilter } from 'src/app/core/models/activity.model';
import { ActivityService } from 'src/app/core/services/activity.service';
import { ConfirmModalComponent } from 'src/app/shared/components/confirm-modal/confirm-modal.component';

@Component({
    selector: 'app-activity',
    templateUrl: './activity.page.html',
    styleUrls: ['./activity.page.scss'],
    imports: [IonicModule, CommonModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class ActivityPage implements OnInit, ViewWillEnter {
  entries = signal<ActivityEntry[]>([]);
  loading = signal<boolean>(true);
  activeFilter = signal<ActivityFilter>('all');

  readonly filters = ACTIVITY_FILTERS;

  filteredEntries = computed(() =>
    this.activeFilter() === 'all'
      ? this.entries()
      : this.entries().filter((e) => e.type === this.activeFilter())
  );

  private readonly activityService = inject(ActivityService);
  private readonly modalController = inject(ModalController);
  private readonly translate = inject(TranslateService);

  ngOnInit(): void {
    this.load();
  }

  ionViewWillEnter(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.entries.set(await this.activityService.findAll());
    this.loading.set(false);
  }

  setFilter(value: SegmentValue | undefined): void {
    if (typeof value === 'string' && (ACTIVITY_FILTERS as string[]).includes(value)) {
      this.activeFilter.set(value as ActivityFilter);
    }
  }

  async confirmClear(): Promise<void> {
    const modal = await this.modalController.create({
      component: ConfirmModalComponent,
      componentProps: {
        icon: 'trash-outline',
        titleKey: 'activity.clear-title',
        descriptionKey: 'activity.clear-description',
        cancelKey: 'activity.clear-cancel',
        actionKey: 'activity.clear-action',
        actionVariant: 'danger',
      },
      backdropDismiss: false,
      showBackdrop: false,
      cssClass: 'confirm-modal',
    });

    await modal.present();

    const { role } = await modal.onWillDismiss();
    if (role === 'confirm') {
      await this.clearAll();
    }
  }

  formatCounterparty(entry: ActivityEntry): string {
    const raw = entry.counterparty?.trim() ?? '';
    if (!raw) {
      return '';
    }
    try {
      const url = new URL(raw);
      if (url.hostname) {
        return url.hostname;
      }
      if (url.protocol === 'did:') {
        return this.truncateDid(raw);
      }
      return raw;
    } catch {
      return raw;
    }
  }

  formatTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(diff / 3_600_000);
    const days = Math.floor(diff / 86_400_000);

    if (minutes < 1) return this.translate.instant('activity.time-now');
    if (minutes < 60) return this.translate.instant('activity.time-minutes', { count: minutes });
    if (hours < 24) return this.translate.instant('activity.time-hours', { count: hours });
    if (days < 7) return this.translate.instant('activity.time-days', { count: days });
    return new Date(timestamp).toLocaleDateString();
  }

  private truncateDid(did: string): string {
    const match = did.match(/^(did:[a-z0-9]+:)(.+)$/i);
    if (!match) {
      return did;
    }
    const [, prefix, identifier] = match;
    if (identifier.length <= 14) {
      return did;
    }
    return `${prefix}${identifier.slice(0, 4)}…${identifier.slice(-6)}`;
  }

  private async clearAll(): Promise<void> {
    await this.activityService.clear();
    this.entries.set([]);
  }
}
