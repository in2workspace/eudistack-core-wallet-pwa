import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController, ViewWillEnter, ViewWillLeave } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { take } from 'rxjs';
import { BarcodeScannerComponent } from 'src/app/shared/components/barcode-scanner/barcode-scanner.component';
import { ManualCodeModalComponent } from 'src/app/shared/components/manual-code-modal/manual-code-modal.component';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { HapticService } from 'src/app/shared/services/haptic.service';
import { QrContentService } from 'src/app/core/services/qr-content.service';

@Component({
  selector: 'app-scan',
  templateUrl: './scan.page.html',
  styleUrls: ['./scan.page.scss'],
  imports: [
    IonicModule,
    CommonModule,
    TranslateModule,
    BarcodeScannerComponent,
  ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class ScanPage implements ViewWillEnter, ViewWillLeave {
  public showScanner = false;

  private readonly router = inject(Router);
  private readonly modalController = inject(ModalController);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly hapticService = inject(HapticService);
  private readonly qrContentService = inject(QrContentService);

  public ionViewWillEnter(): void {
    this.showScanner = true;
  }

  // Ionic caches the page, so ngOnDestroy never runs; tearing the camera down
  // here is what releases the device when the user switches tab.
  public ionViewWillLeave(): void {
    this.showScanner = false;
  }

  public qrCodeEmit(qrCode: string): void {
    this.hapticService.notification();
    const intent = this.qrContentService.parse(qrCode);

    if (intent.kind === 'unsupported') {
      this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.invalid-qr').pipe(take(1)).subscribe();
      return;
    }

    this.showScanner = false;

    const queryParams = intent.kind === 'credential-offer'
      ? { credentialOfferUri: intent.uri }
      : { authorizationRequest: intent.uri };

    this.router.navigate(['/tabs/credentials'], { queryParams })
      .catch(() => this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.navigation').subscribe());
  }

  public async openManualCodeModal(): Promise<void> {
    const modal = await this.modalController.create({
      component: ManualCodeModalComponent,
      cssClass: 'manual-code-modal',
    });

    await modal.present();

    const { data, role } = await modal.onWillDismiss();
    if (role === 'confirm' && typeof data === 'string' && data.trim()) {
      this.qrCodeEmit(data.trim());
    }
  }
}
