import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { environment } from 'src/environments/environment';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';

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
  private readonly discovery = inject(WalletDiscoveryService);

  public userName = '';
  public featureLogsEnabled = environment.logs_enabled;
  public readonly appVersion = environment.appVersion;
  /** True when the wallet operates in server (EBW) mode (AC-009.2c, AC-009.3c). */
  public get isServerMode(): boolean {
    return this.discovery.mode() === 'server';
  }
  public get walletModeKey(): string {
    return this.isServerMode
      ? 'settings.wallet-mode-business'
      : 'settings.wallet-mode-eudiw';
  }
  private readonly pwaInstallService = inject(PwaInstallService);
  private readonly themeService = inject(ThemeService);
  readonly canInstall$ = this.pwaInstallService.installable$;
  readonly prefs = inject(UserPreferencesService);
  public get knowledgeBaseUrl(): string | null {
    return this.themeService.snapshot?.content?.knowledgeBaseUrl ?? null;
  }

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
