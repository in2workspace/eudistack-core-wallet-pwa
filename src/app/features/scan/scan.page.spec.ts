import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { Subject, of } from 'rxjs';
import { Component, EventEmitter, Output } from '@angular/core';
import { ScanPage } from './scan.page';
import { BarcodeScannerComponent } from 'src/app/shared/components/barcode-scanner/barcode-scanner.component';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { HapticService } from 'src/app/shared/services/haptic.service';
import { CameraService } from 'src/app/shared/services/camera.service';

@Component({ selector: 'app-barcode-scanner', standalone: true, template: '' })
class BarcodeScannerStubComponent {
  @Output() public qrCode = new EventEmitter<string>();
  public resultHandled = jest.fn();
}

describe('ScanPage', () => {
  let component: ScanPage;
  let fixture: ComponentFixture<ScanPage>;
  let router: { navigate: jest.Mock };
  let toast: { showErrorAlertByTranslateLabel: jest.Mock };
  let haptic: { notification: jest.Mock };
  let cameraService: { getCameraFlow: jest.Mock };

  beforeEach(async () => {
    router = { navigate: jest.fn().mockResolvedValue(true) };
    toast = { showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(of(null)) };
    haptic = { notification: jest.fn(), impact: jest.fn() } as any;

    cameraService = { getCameraFlow: jest.fn() };

    TestBed.overrideComponent(ScanPage, {
      remove: { imports: [BarcodeScannerComponent] },
      add: { imports: [BarcodeScannerStubComponent] },
    });

    await TestBed.configureTestingModule({
      imports: [ScanPage, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: ToastServiceHandler, useValue: toast },
        { provide: HapticService, useValue: haptic },
        { provide: CameraService, useValue: cameraService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ScanPage);
    component = fixture.componentInstance;
  });

  it('does not mount the scanner nor ask for the camera when the page opens', () => {
    // Arrange
    // Act
    fixture.detectChanges();
    component.ionViewWillLeave();

    // Assert
    expect(component.showScanner).toBe(false);
    expect(fixture.nativeElement.querySelector('app-barcode-scanner')).toBeNull();
    expect(cameraService.getCameraFlow).not.toHaveBeenCalled();
  });

  it('mounts the scanner only after the user asks to scan with the camera', () => {
    // Arrange
    fixture.detectChanges();

    // Act
    fixture.nativeElement.querySelector('.scan-link').click();
    fixture.detectChanges();

    // Assert
    expect(component.showScanner).toBe(true);
    expect(fixture.nativeElement.querySelector('app-barcode-scanner')).toBeTruthy();
  });

  it('removes the scanner element from the DOM on leave, releasing the camera', () => {
    // Arrange
    component.startScanner();
    fixture.detectChanges();

    // Act
    // Ionic caches the page, so the flag alone is not enough: without an explicit
    // change-detection pass the element stays mounted and keeps the MediaStream open.
    component.ionViewWillLeave();

    // Assert
    expect(fixture.nativeElement.querySelector('app-barcode-scanner')).toBeNull();
  });

  describe('pasted code', () => {
    it('disables the continue button while the field is empty or blank', () => {
      // Arrange
      fixture.detectChanges();
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-primary');

      // Act
      component.code.set('   ');
      fixture.detectChanges();

      // Assert
      expect(button.disabled).toBe(true);
    });

    it('enables the continue button once there is a code', () => {
      // Arrange
      fixture.detectChanges();
      const button: HTMLButtonElement = fixture.nativeElement.querySelector('.btn-primary');

      // Act
      component.code.set('some-code');
      fixture.detectChanges();

      // Assert
      expect(button.disabled).toBe(false);
    });

    it('does nothing when submitting a blank code', () => {
      // Arrange
      component.code.set('   ');

      // Act
      component.submitCode();

      // Assert
      expect(router.navigate).not.toHaveBeenCalled();
      expect(toast.showErrorAlertByTranslateLabel).not.toHaveBeenCalled();
    });

    it('trims the pasted credential offer and hands it to the credentials page', () => {
      // Arrange
      component.code.set('  https://issuer.com/api?credential_offer_uri=openid-credential-offer://data \n');

      // Act
      component.submitCode();

      // Assert
      expect(router.navigate).toHaveBeenCalledWith(
        ['/tabs/credentials'],
        { queryParams: { credentialOfferUri: 'openid-credential-offer://data' } }
      );
    });

    it('hands a pasted authorization request to the credentials page', () => {
      // Arrange
      const request = 'openid4vp://authorize?request_uri=https://verifier.com';
      component.code.set(request);

      // Act
      component.submitCode();

      // Assert
      expect(router.navigate).toHaveBeenCalledWith(
        ['/tabs/credentials'],
        { queryParams: { authorizationRequest: request } }
      );
    });

    it('shows an error and does not navigate when the pasted code is unsupported', () => {
      // Arrange
      component.code.set('not-supported-content');

      // Act
      component.submitCode();

      // Assert
      expect(toast.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.invalid-qr');
      expect(router.navigate).not.toHaveBeenCalled();
    });
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
    component.startScanner();
    component.qrCodeEmit('credential_offer_uri=data');

    expect(component.showScanner).toBe(false);
  });

  it('marks the result as handled only after the invalid-QR alert is dismissed', () => {
    const alertDismissed$ = new Subject<void>();
    toast.showErrorAlertByTranslateLabel.mockReturnValue(alertDismissed$.asObservable());

    component.startScanner();
    fixture.detectChanges();
    const scannerStub = fixture.debugElement
      .query(By.directive(BarcodeScannerStubComponent))
      .componentInstance as BarcodeScannerStubComponent;

    component.qrCodeEmit('not-supported-content');
    expect(scannerStub.resultHandled).not.toHaveBeenCalled();

    alertDismissed$.next();
    expect(scannerStub.resultHandled).toHaveBeenCalledTimes(1);
  });
});
