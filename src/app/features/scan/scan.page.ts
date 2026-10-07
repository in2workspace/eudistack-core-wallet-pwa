import { ChangeDetectorRef, Component, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, ViewWillLeave } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { take } from 'rxjs';
import { BarcodeScannerComponent } from 'src/app/shared/components/barcode-scanner/barcode-scanner.component';
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
    FormsModule,
    TranslateModule,
    BarcodeScannerComponent,
  ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class ScanPage implements ViewWillLeave {
  @ViewChild('scanner') private readonly barcodeScanner?: BarcodeScannerComponent;

  public showScanner = false;
  public readonly code = signal('');

  private readonly router = inject(Router);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly hapticService = inject(HapticService);
  private readonly qrContentService = inject(QrContentService);
  private readonly cdr = inject(ChangeDetectorRef);

  public get trimmedCode(): string {
    return this.code().trim();
  }

  public startScanner(): void {
    this.showScanner = true;
  }

  public ionViewWillLeave(): void {
    this.showScanner = false;
    this.cdr.detectChanges();
  }

  public qrCodeEmit(qrCode: string): void {
    void this.hapticService.notification();
    const intent = this.qrContentService.parse(qrCode);

    if (intent.kind === 'unsupported') {
      this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.invalid-qr')
        .pipe(take(1))
        .subscribe(() => this.barcodeScanner?.resultHandled());
      return;
    }

    this.showScanner = false;

    const queryParams = intent.kind === 'credential-offer'
      ? { credentialOfferUri: intent.uri }
      : { authorizationRequest: intent.uri };

    this.router.navigate(['/tabs/credentials'], { queryParams })
      .catch(() => this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.navigation').subscribe());
  }

  public submitCode(): void {
    if (!this.trimmedCode) return;
    this.qrCodeEmit(this.trimmedCode);
  }
}
