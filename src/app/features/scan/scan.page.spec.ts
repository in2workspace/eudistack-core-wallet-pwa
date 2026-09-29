import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { Component, EventEmitter, Output } from '@angular/core';
import { ScanPage } from './scan.page';
import { BarcodeScannerComponent } from 'src/app/shared/components/barcode-scanner/barcode-scanner.component';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { HapticService } from 'src/app/shared/services/haptic.service';

@Component({ selector: 'app-barcode-scanner', standalone: true, template: '' })
class BarcodeScannerStubComponent {
  @Output() public qrCode = new EventEmitter<string>();
  public resumeScanning = jest.fn();
}

describe('ScanPage', () => {
  let component: ScanPage;
  let fixture: ComponentFixture<ScanPage>;
  let router: { navigate: jest.Mock };
  let toast: { showErrorAlertByTranslateLabel: jest.Mock };
  let haptic: { notification: jest.Mock };

  beforeEach(async () => {
    router = { navigate: jest.fn().mockResolvedValue(true) };
    toast = { showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(of(null)) };
    haptic = { notification: jest.fn(), impact: jest.fn() } as any;

    const modalCtrlMock = { create: jest.fn() };

    TestBed.overrideComponent(ScanPage, {
      remove: { imports: [BarcodeScannerComponent] },
      add: { imports: [BarcodeScannerStubComponent] },
    });

    TestBed.overrideComponent(ScanPage, {
      add: { providers: [{ provide: ModalController, useValue: modalCtrlMock }] },
    });

    await TestBed.configureTestingModule({
      imports: [ScanPage, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: ToastServiceHandler, useValue: toast },
        { provide: HapticService, useValue: haptic },
        { provide: ModalController, useValue: modalCtrlMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanPage);
    component = fixture.componentInstance;
  });

  it('starts the camera on enter and tears it down on leave', () => {
    component.ionViewWillEnter();
    expect(component.showScanner).toBe(true);

    component.ionViewWillLeave();
    expect(component.showScanner).toBe(false);
  });

  it('removes the scanner element from the DOM on leave, releasing the camera', () => {
    component.ionViewWillEnter();
    expect(fixture.nativeElement.querySelector('app-barcode-scanner')).toBeTruthy();

    // Ionic caches the page, so the flag alone is not enough: without an explicit
    // change-detection pass the element stays mounted and keeps the MediaStream open.
    component.ionViewWillLeave();
    expect(fixture.nativeElement.querySelector('app-barcode-scanner')).toBeNull();
  });

  it('shows an error and does not navigate on unsupported content', () => {
    component.qrCodeEmit('not-supported-content');

    expect(haptic.notification).toHaveBeenCalled();
    expect(toast.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.invalid-qr');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('hands a credential offer to the credentials page', () => {
    component.qrCodeEmit('https://issuer.com/api?credential_offer_uri=openid-credential-offer://data');

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tabs/credentials'],
      { queryParams: { credentialOfferUri: 'openid-credential-offer://data' } }
    );
  });

  it('hands an authorization request to the credentials page', () => {
    const qr = 'openid4vp://authorize?request_uri=https://verifier.com';

    component.qrCodeEmit(qr);

    expect(router.navigate).toHaveBeenCalledWith(
      ['/tabs/credentials'],
      { queryParams: { authorizationRequest: qr } }
    );
  });

  it('stops the camera once a valid code is handed over', () => {
    component.ionViewWillEnter();
    component.qrCodeEmit('credential_offer_uri=data');

    expect(component.showScanner).toBe(false);
  });

  it('resumes scanning only after the invalid-QR alert is dismissed', () => {
    const alertDismissed$ = new Subject<void>();
    toast.showErrorAlertByTranslateLabel.mockReturnValue(alertDismissed$.asObservable());

    component.ionViewWillEnter();
    const scannerStub = fixture.debugElement
      .query(By.directive(BarcodeScannerStubComponent))
      .componentInstance as BarcodeScannerStubComponent;

    component.qrCodeEmit('not-supported-content');
    expect(scannerStub.resumeScanning).not.toHaveBeenCalled();

    alertDismissed$.next();
    expect(scannerStub.resumeScanning).toHaveBeenCalledTimes(1);
  });
});
