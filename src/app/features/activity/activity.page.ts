import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, AlertController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ActivityEntry } from 'src/app/core/models/activity.model';
import { ActivityService } from 'src/app/core/services/activity.service';

@Component({
    selector: 'app-activity',
    templateUrl: './activity.page.html',
    styleUrls: ['./activity.page.scss'],
    imports: [IonicModule, CommonModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class ActivityPage implements OnInit {
  entries: ActivityEntry[] = [];
  loading = true;

  private readonly activityService = inject(ActivityService);
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.entries = await this.activityService.findAll();
    this.loading = false;
  }

  async confirmClear(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('activity.clear-confirm'),
      buttons: [
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('activity.clear'),
          cssClass: 'danger',
          handler: () => this.clearAll(),
        },
      ],
    });
    await alert.present();
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

  private async clearAll(): Promise<void> {
    await this.activityService.clear();
    this.entries = [];
  }
}
