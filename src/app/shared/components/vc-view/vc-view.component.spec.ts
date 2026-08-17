/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';
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
      type: ['learcredential.employee.w3c.4'],
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
    const machineVc = {
      ...current,
      type: ['learcredential.machine.w3c.3'],
      credentialEncoded: 'encoded_value' as any,
    } as any;
    componentRef.setInput('credentialInput$', machineVc);
    fixture.detectChanges();
    expect(component.credentialType()).toBe('learcredential.machine.w3c.3');
    await (component as any).updateDetailSections(machineVc);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeTruthy();
    expect(encodedSection?.fields.length).toBe(1);
    expect(encodedSection?.fields[0].label).toBe('vc-fields.credentialEncoded');
    expect(encodedSection?.fields[0].value).toBe('encoded_value');
  });

  it('should add credentialEncoded section for LEARCredentialMachine type array', async () => {
    const current = component.credentialInput$();
    const machineVc = {
      ...current,
      type: ['VerifiableCredential', 'LEARCredentialMachine'],
      credentialEncoded: 'encoded_machine_value' as any,
    } as any;
    componentRef.setInput('credentialInput$', machineVc);
    fixture.detectChanges();
    expect(component.credentialType()).toBe('LEARCredentialMachine');

    await (component as any).updateDetailSections(machineVc);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeTruthy();
    expect(encodedSection?.fields[0].label).toBe('vc-fields.credentialEncoded');
    expect(encodedSection?.fields[0].value).toBe('encoded_machine_value');
  });

  it('should add credentialEncoded section for gx:LabelCredential type array', async () => {
    const current = component.credentialInput$();
    const labelVc = {
      ...current,
      type: ['VerifiableCredential', 'gx:LabelCredential'],
      credentialEncoded: 'encoded_label_value' as any,
    } as any;
    componentRef.setInput('credentialInput$', labelVc);
    fixture.detectChanges();
    expect(component.credentialType()).toBe('gx:LabelCredential');

    await (component as any).updateDetailSections(labelVc);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeTruthy();
    expect(encodedSection?.fields[0].label).toBe('vc-fields.credentialEncoded');
    expect(encodedSection?.fields[0].value).toBe('encoded_label_value');
  });

  it('should NOT add credentialEncoded section for machine/label type when credentialEncoded is missing', async () => {
    const current = component.credentialInput$();
    const labelVcWithoutEncoded = {
      ...current,
      type: ['VerifiableCredential', 'gx:LabelCredential'],
    } as any;
    delete labelVcWithoutEncoded.credentialEncoded;
    componentRef.setInput('credentialInput$', labelVcWithoutEncoded);
    fixture.detectChanges();

    await (component as any).updateDetailSections(labelVcWithoutEncoded);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeUndefined();
  });

  it('should NOT add credentialEncoded section for non-machine/label type even with credentialEncoded', async () => {
    const current = component.credentialInput$();
    const employeeVc = {
      ...current,
      type: ['VerifiableCredential', 'LEARCredentialEmployee'],
      credentialEncoded: 'encoded_value' as any,
    } as any;
    componentRef.setInput('credentialInput$', employeeVc);
    fixture.detectChanges();

    await (component as any).updateDetailSections(employeeVc);

    const encodedSection = component.detailViewSections$().find(
      s => s.section === 'vc-fields.credentialEncoded'
    );
    expect(encodedSection).toBeUndefined();
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

  describe('verifyCredential', () => {
    let verificationService: CredentialVerificationServiceMock;

    beforeEach(() => {
      verificationService = TestBed.inject(CredentialVerificationService) as unknown as CredentialVerificationServiceMock;
      // Skip the artificial UI pacing delays so the checks resolve immediately.
      jest.spyOn(component as any, 'delay').mockResolvedValue(undefined);
    });

    it('should end as "unknown" and NOT persist REVOKED when the status check could not be completed', async () => {
      // Arrange
      verificationService.getCheckKeys.mockReturnValue(['status']);
      verificationService.runCheck.mockResolvedValue({
        key: 'status',
        status: 'error',
        detail: 'verification.detail-check-error',
      });
      const updateStatusSpy = jest.spyOn(walletService, 'updateCredentialStatus');

      // Act
      await component.verifyCredential();

      // Assert — fail-closed on uncertainty: never shown as valid, never persisted as revoked
      expect(component.verifyOverall).toBe('unknown');
      expect(component.verifyResultKey).toBe('verification.result-unknown');
      expect(updateStatusSpy).not.toHaveBeenCalled();
    });

    it('should end as "invalid" and persist REVOKED when the status check confirms revocation', async () => {
      // Arrange
      verificationService.getCheckKeys.mockReturnValue(['status']);
      verificationService.runCheck.mockResolvedValue({
        key: 'status',
        status: 'failed',
        detail: 'verification.detail-revoked',
      });

      // Act
      await component.verifyCredential();

      // Assert
      expect(component.verifyOverall).toBe('invalid');
      expect(component.verifyResultKey).toBe('verification.result-revoked');
      expect(walletService.updateCredentialStatus).toHaveBeenCalledWith('testId', 'REVOKED');
    });

    it('should end as "invalid" with the generic message when a check fails for a reason other than revocation or expiration', async () => {
      // Arrange
      verificationService.getCheckKeys.mockReturnValue(['issuer']);
      verificationService.runCheck.mockResolvedValue({ key: 'issuer', status: 'failed' });

      // Act
      await component.verifyCredential();

      // Assert
      expect(component.verifyOverall).toBe('invalid');
      expect(component.verifyResultKey).toBe('verification.result-invalid');
      expect(walletService.updateCredentialStatus).not.toHaveBeenCalled();
    });

    it('should end as "valid" when every check passes', async () => {
      // Arrange
      verificationService.getCheckKeys.mockReturnValue(['issuer', 'status']);
      verificationService.runCheck.mockImplementation(async (key: string) => ({ key, status: 'passed' as const }));

      // Act
      await component.verifyCredential();

      // Assert
      expect(component.verifyOverall).toBe('valid');
    });

    it('should prioritize a confirmed failure over an unrelated check error', async () => {
      // Arrange — expiration genuinely failed while the status list happened to be unreachable
      verificationService.getCheckKeys.mockReturnValue(['expiration', 'status']);
      verificationService.runCheck.mockImplementation(async (key: string) => {
        if (key === 'expiration') return { key, status: 'failed' as const };
        return { key, status: 'error' as const, detail: 'verification.detail-check-error' };
      });

      // Act
      await component.verifyCredential();

      // Assert — a known, confirmed problem must never be masked by an unrelated network error
      expect(component.verifyOverall).toBe('invalid');
      expect(component.verifyResultKey).toBe('verification.result-expired');
    });
  });

  // AC-10 / NFR-S-142-08: credential content must never be handed to a page
  // translation engine, regardless of whether the EUD-142 runtime translation
  // feature is enabled or even available on the device (AD-4). Double marking
  // (container + value element) because ion-modal reparents its content into
  // the ion-app tree, where inheritance from the original host is not reliable.
  describe('translate="no" shielding (AC-10, NFR-S-142-08)', () => {
    it('marks the credential card container as non-translatable', () => {
      const card = fixture.nativeElement.querySelector('ion-card.credential-card');
      expect(card.getAttribute('translate')).toBe('no');
    });

    it('marks the card title as non-translatable', () => {
      const title = fixture.nativeElement.querySelector('.card-title');
      expect(title.getAttribute('translate')).toBe('no');
    });

    it('marks each card field value as non-translatable', async () => {
      const displayService = TestBed.inject(CredentialDisplayService);
      jest.spyOn(displayService, 'getCardFields').mockResolvedValue([{ label: 'field.label', value: 'Jane Doe' }]);
      componentRef.setInput('credentialInput$', { ...component.credentialInput$() });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const field = fixture.nativeElement.querySelector('.card-field');
      expect(field.getAttribute('translate')).toBe('no');
    });

    // The detail modal's markup (.modal-content, .field-value, .structured-value/-label,
    // .copy-row__text) lives inside <ion-modal><ng-template>. @ionic/angular's IonModal
    // wrapper only materializes that ng-template into the DOM (via NgTemplateOutlet) once
    // `isCmpOpen` flips true, which happens on real Ionic overlay lifecycle events dispatched
    // by the @ionic/core Stencil custom element — not registered in this repo's Jest/jsdom
    // setup (no other spec in the repo renders ion-modal content either). Their translate="no"
    // markings (verified present in vc-view.component.html) are therefore checked manually per
    // the AC-10/NFR-S-142-08 checklist in quality-report.md, consistent with the test matrix's
    // own "Manual" row in technical-design.md §2.3.

    // The verification modal (opened by a *sibling* <ion-modal>, not the
    // detail modal above) has the exact same rendering limitation under
    // jsdom. Rather than rely on the same manual-only checklist a second
    // time — which is precisely how F1 (security-auditor full-mode review,
    // EUD-142) shipped without a translate="no" marker on this modal's
    // content and its issuer/date detail span — this parses the raw
    // template source and asserts the attribute is present on every element
    // that renders credential-provenance data, across both modals. A
    // structural regression (removing the attribute, or adding a new
    // unshielded credential-data binding) now fails CI instead of requiring
    // a human to remember the checklist.
    describe('template-source structural check (F1/F8 regression guard)', () => {
      const templateSource = readFileSync(join(__dirname, 'vc-view.component.html'), 'utf-8');

      function openingTagContaining(needle: string): string {
        const idx = templateSource.indexOf(needle);
        expect(idx).toBeGreaterThan(-1); // the expression must actually exist in the template
        const tagStart = templateSource.lastIndexOf('<', idx);
        const tagEnd = templateSource.indexOf('>', tagStart);
        return templateSource.slice(tagStart, tagEnd + 1);
      }

      it.each([
        ['card title', '{{ displayName() || credentialType }}'],
        ['card field value', '{{ field.value }}'],
        ['structured field label', '{{ item.label }}'],
        ['structured field value', '{{ item.value }}'],
        ['verification modal content container', 'class="verify-modal-content"'],
        ['verification check detail (issuer/dates)', '{{ check.detail | translate }}'],
      ])('%s carries [attr.translate]="\'no\'"', (_name, needle) => {
        expect(openingTagContaining(needle)).toContain('[attr.translate]="\'no\'"');
      });
    });
  });

});