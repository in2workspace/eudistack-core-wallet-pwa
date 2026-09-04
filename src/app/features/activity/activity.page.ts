import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ToastController, ViewWillEnter } from '@ionic/angular';
import { SegmentValue } from '@ionic/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ACTIVITY_FILTERS, ActivityEntry, ActivityFilter } from 'src/app/core/models/activity.model';
import { ActivityExportLabels, ActivityExportService } from 'src/app/core/services/activity-export.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { ConfirmModalComponent } from 'src/app/shared/components/confirm-modal/confirm-modal.component';
import { formatAbsoluteTime, formatCounterparty } from 'src/app/shared/utils/activity-format.util';
import { ActivityDetailComponent } from './activity-detail/activity-detail.component';

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

  /**
   * Hides the "clear history" action while product decides whether the wallet
   * keeps it at all. The flow behind it (confirmClear → ConfirmModalComponent →
   * ActivityService.clear) stays wired and tested; flip this to re-expose it.
   */
  readonly clearHistoryEnabled = false;

  readonly formatCounterparty = formatCounterparty;
  readonly formatAbsoluteTime = (timestamp: number) => formatAbsoluteTime(timestamp, this.translate.currentLang ?? 'en');

  filteredEntries = computed(() =>
    this.activeFilter() === 'all'
      ? this.entries()
      : this.entries().filter((e) => e.type === this.activeFilter())
  );

  private readonly activityService = inject(ActivityService);
  private readonly activityExportService = inject(ActivityExportService);
  private readonly modalController = inject(ModalController);
  private readonly router = inject(Router);
  private readonly toastController = inject(ToastController);
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
        actionVariant: 'primary',
      },
      backdropDismiss: false,
      showBackdrop: false,
      cssClass: 'confirm-modal confirm-modal--wide',
    });

    await modal.present();

    const { role } = await modal.onWillDismiss();
    if (role === 'confirm') {
      await this.clearAll();
    }
  }

  async openDetail(entry: ActivityEntry | null | undefined): Promise<void> {
    if (!entry) return;

    const modal = await this.modalController.create({
      component: ActivityDetailComponent,
      componentProps: { entry, locale: this.translate.currentLang ?? 'en' },
      cssClass: 'activity-detail-modal',
    });

    await modal.present();
  }

  onEntryKeydown(event: KeyboardEvent, entry: ActivityEntry): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.openDetail(entry);
    }
  }

  backToWallet(): void {
    void this.router.navigate(['/tabs/credentials']);
  }

  addCredential(): void {
    void this.router.navigate(['/tabs/scan']);
  }


  formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    const locale = this.translate.currentLang ?? 'en';
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }).toLowerCase();
    return `${this.formatDatePart(date, locale)} · ${time}`;
  }

  private formatDatePart(date: Date, locale: string): string {
    const today = new Date();
    const isToday =
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate();

    if (isToday) {
      return this.translate.instant('activity.date-today');
    }

    const day = `${date.getDate()}`.padStart(2, '0');
    const month = date.toLocaleDateString(locale, { month: 'short' }).replace('.', '');
    return `${day} ${month.charAt(0).toUpperCase()}${month.slice(1)} ${date.getFullYear()}`;
  }

  exportHistory(): void {
    try {
      const csv = this.activityExportService.buildCsv(this.entries(), this.buildExportLabels());
      const filename = this.activityExportService.buildFileName(new Date());
      this.activityExportService.triggerDownload(csv, filename);
    } catch {
      void this.showExportError();
    }
  }

  private buildExportLabels(): ActivityExportLabels {
    return {
      headers: {
        type: this.translate.instant('activity.csv-header-type'),
        credentialName: this.translate.instant('activity.csv-header-credential'),
        counterparty: this.translate.instant('activity.csv-header-counterparty'),
        timestamp: this.translate.instant('activity.csv-header-date'),
        details: this.translate.instant('activity.csv-header-details'),
      },
      types: {
        issued: this.translate.instant('activity.type-issued'),
        presented: this.translate.instant('activity.type-presented'),
        deleted: this.translate.instant('activity.type-deleted'),
      },
    };
  }

  private async showExportError(): Promise<void> {
    const toast = await this.toastController.create({
      message: this.translate.instant('activity.export-error'),
      duration: 3000,
      color: 'danger',
      position: 'bottom',
    });
    await toast.present();
  }

  private async clearAll(): Promise<void> {
    await this.activityService.clear();
    this.entries.set([]);
  }
}
