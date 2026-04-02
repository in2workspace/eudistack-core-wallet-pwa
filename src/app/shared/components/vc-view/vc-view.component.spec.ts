import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { VcViewComponent } from './vc-view.component';
import { WalletService } from 'src/app/core/services/wallet.service';
import { VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { Observable, of, throwError } from 'rxjs';
import { TranslateModule } from '@ngx-translate/core';
import { RouterTestingModule } from '@angular/router/testing';
import { CallbackPage } from 'src/app/features/callback/callback.page';
import { ComponentRef } from '@angular/core';
import { CredentialDisplayService } from 'src/app/core/services/credential-display.service';
import { CredentialVerificationService } from 'src/app/core/services/credential-verification.service';
import { convertToParamMap, Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

class WalletServiceMock {
  getVCinCBOR(credential: VerifiableCredential) {
    return of('mock_cbor_string');
  }
  requestSignature(credentialId: string): Observable<any> {
    return of({ success: true });
  }
  updateCredentialStatus = jest.fn().mockReturnValue(of(undefined));
}

class CredentialDisplayServiceMock {
  getCardFields = jest.fn().mockResolvedValue([]);
  getDisplayName = jest.fn().mockResolvedValue('Test Credential');
  getFormatLabel = jest.fn().mockReturnValue('');
  getDetailSections = jest.fn().mockResolvedValue([]);
}

class CredentialVerificationServiceMock {
  getCheckKeys = jest.fn().mockReturnValue([]);
  runCheck = jest.fn().mockResolvedValue({ key: 'test', status: 'passed' });
}

class ActivatedRouteMock {
  private readonly _queryParamMap$ = new BehaviorSubject(convertToParamMap({}));
  public readonly queryParamMap = this._queryParamMap$.asObservable();

  public setQueryParams(params: Record<string, any>): void {
    this._queryParamMap$.next(convertToParamMap(params));
  }
}

describe('VcViewComponent', () => {
  let component: VcViewComponent;
  let componentRef: ComponentRef<VcViewComponent>;
  let fixture: ComponentFixture<VcViewComponent>;
  let walletService: WalletService;
  let router: Router;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule.withRoutes([{path:'tabs/credentials', component:CallbackPage}]),
        TranslateModule.forRoot(),
        VcViewComponent,
      ],
      providers: [
        { provide: WalletService, useClass: WalletServiceMock },
        { provide: CredentialDisplayService, useClass: CredentialDisplayServiceMock },
        { provide: CredentialVerificationService, useClass: CredentialVerificationServiceMock },
        { provide: ActivatedRoute, useClass: ActivatedRouteMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(VcViewComponent);
    component = fixture.componentInstance;
    componentRef = fixture.componentRef;
    walletService = TestBed.inject(WalletService);
    router = TestBed.inject(Router);

    componentRef.setInput('credentialInput$', {
      '@context': [],
      id: 'testId',
      type: ['learcredential.employee.w3c.1'],
      issuer: { id: 'issuerId' },
      validFrom: '',
      validUntil: new Date(Date.now() + 86400000).toISOString(),
      credentialSubject: {
        mandate: {
          id: 'mandateId',
          mandator: {
            commonName: '',
            serialNumber: '',
            organization: '',
            country: '',
            organizationIdentifier: ''
          },
          mandatee: {
            id: 'mandateeId',
            firstName: '',
            lastName: '',
            email: '',
            employeeId: '',
            domain: '',
            ipAddress: ''
          },
          power: [
            {
              id: '',
              type: '',
              domain: '',
              function: '',
              action: [''],
            },
          ]
        },
      },
      lifeCycleStatus: "ISSUED",
      credentialStatus: {} as any,
    });

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('qrView should handle credential correctly if not expired', () => {
    const mockCBOR = 'mock_cbor_string';
    jest.spyOn(walletService, 'getVCinCBOR').mockReturnValue(of(mockCBOR));

    component.qrView();

    expect(walletService.getVCinCBOR).toHaveBeenCalledWith(component.credentialInput$());
    expect(component.cred_cbor).toEqual(mockCBOR);
    expect(component.isAlertOpenNotFound).toBeFalsy();
  });

  it('setOpen should correctly set isModalOpen', () => {
    component.setOpen(true);
    expect(component.isModalOpen).toBeTruthy();

    component.setOpen(false);
    expect(component.isModalOpen).toBeFalsy();
  });

  it('setOpenNotFound should correctly set isAlertOpenNotFound', () => {
    component.setOpenNotFound(true);
    expect(component.isAlertOpenNotFound).toBeTruthy();

    component.setOpenNotFound(false);
    expect(component.isAlertOpenNotFound).toBeFalsy();
  });

  it('setOpenDeleteNotFound should correctly set isAlertOpenDeleteNotFound', () => {
    component.setOpenDeleteNotFound(true);
    expect(component.isAlertOpenDeleteNotFound).toBeTruthy();

    component.setOpenDeleteNotFound(false);
    expect(component.isAlertOpenDeleteNotFound).toBeFalsy();
  });

  it('setOpenExpirationNotFound should correctly set isAlertExpirationOpenNotFound', () => {
    component.setOpenExpirationNotFound(true);
    expect(component.isAlertExpirationOpenNotFound).toBeTruthy();

    component.setOpenExpirationNotFound(false);
    expect(component.isAlertExpirationOpenNotFound).toBeFalsy();
  });

  it('deleteVC should set isModalDeleteOpen to true', () => {
    component.deleteVC();
    expect(component.isModalDeleteOpen).toBeTruthy();
  });

  it('unsignedInfo should set isModalUnsignedOpen to true', () => {
    const mockEvent = new Event('click');
    component.unsignedInfo(mockEvent);
    expect(component.isModalUnsignedOpen).toBeTruthy();
  });

  it('clicking on delete button in deleteButtons should change isModalDeleteOpen accordingly', () => {
    jest.spyOn(component.vcEmit, 'emit');

    component.deleteButtons[0].handler();
    expect(component.isModalDeleteOpen).toBeFalsy();

    component.isModalDeleteOpen = false;

    component.deleteButtons[1].handler();
    expect(component.isModalDeleteOpen).toBeTruthy();
    expect(component.vcEmit.emit).toHaveBeenCalledWith(
      component.credentialInput$()
    );
  });

  it('clicking on OK button in alertButtons should set isModalOpen correctly', () => {
    component.alertButtons[0].handler();
    expect(component.isModalOpen).toBeTruthy();
  });

  it('clicking on close button in unsignedButtons should change isModalUnsignedOpen accordingly', () => {
    jest.spyOn(component.vcEmit, 'emit');

    component.unsignedButtons[0].handler();
    expect(component.isModalUnsignedOpen).toBeFalsy();
  });

  it('qrView should handle HTTP errors correctly', () => {
    const mockError = new Error('Network issue');
    jest.spyOn(walletService, 'getVCinCBOR').mockReturnValue(throwError(() => mockError));

    component.qrView();

    expect(component.isAlertOpenNotFound).toBeTruthy();
  });

  it('should call deleteVC when keydown event with key "Enter" and action "delete"', fakeAsync(() => {
    jest.spyOn(component, 'deleteVC');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    component.handleButtonKeydown(event, 'delete');
    tick();
    expect(component.deleteVC).toHaveBeenCalled();
  }));

  it('should call setOpen when keydown event with key " " and action "close"', fakeAsync(() => {
    jest.spyOn(component, 'setOpen');
    const event = new KeyboardEvent('keydown', { key: ' ' });
    component.handleButtonKeydown(event, 'close');
    tick();
    expect(component.setOpen).toHaveBeenCalledWith(false);
  }));

  it('should call unsignedInfo when keydown event with key "Enter" and action "info"', fakeAsync(() => {
    jest.spyOn(component, 'unsignedInfo');
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    component.handleButtonKeydown(event, 'info');
    tick();
    expect(component.unsignedInfo).toHaveBeenCalled();
  }));

  it('should prevent default behavior for button keydown event', fakeAsync(() => {
    const event = new KeyboardEvent('keydown', { key: 'Enter' });
    jest.spyOn(event, 'preventDefault');
    component.handleButtonKeydown(event, 'delete');
    tick();
    expect(event.preventDefault).toHaveBeenCalled();
  }));

  it('openDetailModal should navigate to credentials with id query param', async () => {
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);
    await component.openDetailModal();
    expect(navigateSpy).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { id: 'testId' },
      queryParamsHandling: 'merge',
    });
  });

   it('openDetailModal should not navigate when detail view is disabled', async () => {
      const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

      componentRef.setInput('enableDetailView$', false);
      fixture.detectChanges();
      await fixture.whenStable();

      await component.openDetailModal();

      expect(navigateSpy).not.toHaveBeenCalled();
    });
  

  it('closeDetailModal should navigate clearing id query param when detail view is active and enabled', () => {
    const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    componentRef.setInput('enableDetailView$', true);
    componentRef.setInput('selectedVcId', component.credentialInput$().id);
    fixture.detectChanges();

    component.closeDetailModal();

    expect(navigateSpy).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { id: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  });

  describe('expiryStatus', () => {
    it('should return "valid" when validUntil is far in the future', () => {
      const future = new Date(Date.now() + 365 * 86400000).toISOString();
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        validUntil: future,
      });
      fixture.detectChanges();
      expect(component.expiryStatus()).toBe('valid');
    });

    it('should return "expiring-soon" when validUntil is within 30 days', () => {
      const soon = new Date(Date.now() + 15 * 86400000).toISOString();
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        validUntil: soon,
      });
      fixture.detectChanges();
      expect(component.expiryStatus()).toBe('expiring-soon');
    });

    it('should return "expired" when validUntil is in the past', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        validUntil: past,
      });
      fixture.detectChanges();
      expect(component.expiryStatus()).toBe('expired');
    });

    it('should return "valid" when validUntil is empty', () => {
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        validUntil: '',
      });
      fixture.detectChanges();
      expect(component.expiryStatus()).toBe('valid');
    });
  });

  describe('copyToClipboard', () => {
    let originalClipboard: typeof navigator.clipboard;
    let showToastSpy: jest.SpyInstance;

    beforeEach(() => {
      originalClipboard = navigator.clipboard;
      (navigator as any).clipboard = {
        writeText: jest.fn().mockResolvedValue(undefined),
      };
      showToastSpy = jest.spyOn((component as any).toastService, 'showToast').mockImplementation(() => {});
    });

    afterEach(() => {
      (navigator as any).clipboard = originalClipboard;
      showToastSpy.mockRestore();
      jest.clearAllMocks();
    });

    it('should copy text to clipboard and show toast on success', async () => {
      const text = 'test text';
      await component.copyToClipboard(text);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(text);
      expect(showToastSpy).toHaveBeenCalledWith('vc-fields.copy-success');
    });
  });

  it('should add credentialEncoded section for machine credential type when building detail sections', async () => {
    const current = component.credentialInput$();
    component.credentialType = 'learcredential.machine.w3c.1' as any;
    const machineVc = {
      ...current,
      type: ['learcredential.machine.w3c.1'],
      credentialEncoded: 'encoded_value' as any,
    } as any;
    componentRef.setInput('credentialInput$', machineVc);
    fixture.detectChanges();
    await (component as any).updateDetailSections(machineVc);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeTruthy();
    expect(encodedSection?.fields.length).toBe(1);
    expect(encodedSection?.fields[0].label).toBe('vc-fields.credentialEncoded');
    expect(encodedSection?.fields[0].value).toBe('encoded_value');
  });

  it('should use issuer string when issuer is a plain string when building detail sections', async () => {
    const current = component.credentialInput$();
    componentRef.setInput('credentialInput$', {
      ...current,
      issuer: 'did:example:issuer'
    });
    fixture.detectChanges();
    await (component as any).updateDetailSections(component.credentialInput$());

    const credentialInfoSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.title'
    );
    expect(credentialInfoSection).toBeTruthy();

    const issuerIdField = credentialInfoSection!.fields.find(
      f => f.label === 'vc-fields.credentialInfo.issuerId'
    );
    expect(issuerIdField).toBeTruthy();
    expect(issuerIdField!.value).toBe('did:example:issuer');
  });

  describe('statusChanged', () => {
    it('should emit statusChanged and call updateCredentialStatus when status changes', () => {
      jest.spyOn(component.statusChanged, 'emit');

      // Set credential to VALID so the status change triggers
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        lifeCycleStatus: 'VALID',
      });
      fixture.detectChanges();

      // Call the private method via bracket notation
      (component as any).updateLifeCycleStatus('REVOKED');

      expect(walletService.updateCredentialStatus).toHaveBeenCalledWith('testId', 'REVOKED');
      expect(component.statusChanged.emit).toHaveBeenCalledWith({ id: 'testId', status: 'REVOKED' });
    });

    it('should NOT emit statusChanged when status is the same', () => {
      jest.spyOn(component.statusChanged, 'emit');

      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        lifeCycleStatus: 'REVOKED',
      });
      fixture.detectChanges();

      (component as any).updateLifeCycleStatus('REVOKED');

      expect(walletService.updateCredentialStatus).not.toHaveBeenCalled();
      expect(component.statusChanged.emit).not.toHaveBeenCalled();
    });

    it('should not mutate the credential input directly', () => {
      componentRef.setInput('credentialInput$', {
        ...component.credentialInput$(),
        lifeCycleStatus: 'VALID',
      });
      fixture.detectChanges();

      const credBefore = component.credentialInput$();
      (component as any).updateLifeCycleStatus('EXPIRED');

      // The component should NOT have mutated the input — parent owns that
      expect(credBefore.lifeCycleStatus).toBe('VALID');
    });
  });

});