import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { environment } from 'src/environments/environment';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';

@Component({
    selector: 'app-settings',
    templateUrl: './settings.page.html',
    styleUrls: ['./settings.page.scss'],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        RouterModule,
        TranslateModule,
    ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class SettingsPage {
  public userName = '';
  public featureLogsEnabled = environment.logs_enabled;
  public isServerMode = (environment as any).wallet_mode === 'server';

  private readonly pwaInstallService = inject(PwaInstallService);
  readonly canInstall$ = this.pwaInstallService.installable$;

  public constructor(
    private router: Router,
    private cameraLogsService: CameraLogsService,
    private translate: TranslateService
  ) {
  }

  public async installApp(): Promise<void> {
    await this.pwaInstallService.promptInstall();
  }

  public async sendCameraLogs() {
    this.translate.get('mailto_permission_alert').subscribe(async (translatedMsg: string) => {
      try {
        alert(translatedMsg); //acceptable alert, not in PRD
        await this.cameraLogsService.fetchCameraLogs();
        this.cameraLogsService.sendCameraLogs();
      } catch (error) {
        console.error('Error sending camera logs:', error);
      }
  });
}
}
