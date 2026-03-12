import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { HapticService } from 'src/app/shared/services/haptic.service';

@Component({
    selector: 'app-home',
    templateUrl: './home.page.html',
    styleUrls: ['./home.page.scss'],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        TranslateModule,
        RouterModule,
    ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class HomePage {
  @Input() public availableDevices: MediaDeviceInfo[] = [];
  public userName = '';
  public desactivar = true;
  public bannerDismissed = false;

  private readonly pwaInstallService = inject(PwaInstallService);
  private readonly hapticService = inject(HapticService);
  readonly canInstall$ = this.pwaInstallService.installable$;

  public constructor(private readonly router: Router,
    private readonly toastService: ToastServiceHandler) { }

  public async installApp(): Promise<void> {
    await this.pwaInstallService.promptInstall();
  }

  public dismissInstallBanner(): void {
    this.bannerDismissed = true;
  }

  public async startScan(): Promise<void> {
    this.hapticService.impact();
    const scanRoute = '/tabs/credentials/';
    try{
      await this.router.navigate([scanRoute], {
        queryParams: { showScannerView: true, showScanner: true },
      });
    }catch(err){
      console.error('Error when trying to navigate to ' + scanRoute);
      this.toastService.showErrorAlertByTranslateLabel("errors.navigation").subscribe();
    }
  }
  public handleButtonKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {

      this.startScan();
      event.preventDefault();
    }
  }
}
