import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { EMPTY, of } from 'rxjs';
import { ModalController } from '@ionic/angular';
import { CredentialsPage } from './credentials.page';
import { VcViewComponent } from 'src/app/shared/components/vc-view/vc-view.component';
import { AuthorizationRequestService } from 'src/app/core/protocol/oid4vp/authorization-request.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CredentialPreviewBuilderService } from 'src/app/core/services/credential-preview-builder.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import { IssuerNotificationService } from 'src/app/core/services/issuer-notification.service';
import { IssuerMetadataCacheService } from 'src/app/core/services/issuer-metadata-cache.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { HapticService } from 'src/app/shared/services/haptic.service';
import { CredentialVerificationService } from 'src/app/core/services/credential-verification.service';
import { CredentialDisplayService } from 'src/app/core/services/credential-display.service';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { StorageService } from 'src/app/shared/services/storage.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { VerifiableCredential } from 'src/app/core/models/verifiable-credential';

const mockModalController = {
  create: jest.fn().mockResolvedValue({
    present: jest.fn().mockResolvedValue(undefined),
    onWillDismiss: jest.fn().mockResolvedValue({ role: 'cancel', data: null }),
  }),
};

describe('CredentialsPage - verifiablePresentationFlow', () => {
  let component: CredentialsPage;
  let fixture: ComponentFixture<CredentialsPage>;
  let mockRouter: { navigate: jest.Mock };
  let mockAuthorizationRequestService: { parseAuthorizationRequestFromQr: jest.Mock };
  let mockCredentialCacheService: {
    getAll: jest.Mock;
    findCredentialsByDcqlQuery: jest.Mock;
    findCredentialsByScope: jest.Mock;
    status: jest.Mock;
    credentials: jest.Mock;
    snapshot: jest.Mock;
    patchStatus: jest.Mock;
    remove: jest.Mock;
  };
  let mockWalletService: { refreshCredentials: jest.Mock; getAllVCs: jest.Mock; updateCredentialStatus: jest.Mock };
  let mockToastServiceHandler: { showErrorAlertByTranslateLabel: jest.Mock; showToast: jest.Mock; showErrorAlert: jest.Mock };
  let mockHaptic: any;

  const mockValidVc: VerifiableCredential = { id: 'vc-valid', lifeCycleStatus: 'VALID' } as any;
  const mockRevokedVc: VerifiableCredential = { id: 'vc-revoked', lifeCycleStatus: 'REVOKED' } as any;

  // QR code without credential_offer_uri triggers the VP (authorization request) flow
  const vpQrCode = 'openid4vp://authorize?request_uri=http://example.com';

  // Mock auth request returned by parseAuthorizationRequestFromQr.
  // With dcqlQuery and scope both null, the flow falls back to getAll() for VC selection.
  const mockAuthRequest = {
    responseUri: 'http://example.com/callback',
    state: 'test-state',
    nonce: 'test-nonce',
    clientId: 'client-id',
    dcqlQuery: null,
    scope: null,
  };

  beforeEach(async () => {
    mockRouter = { navigate: jest.fn().mockResolvedValue(true) };

    mockAuthorizationRequestService = {
      parseAuthorizationRequestFromQr: jest.fn().mockResolvedValue(mockAuthRequest),
    };

    mockCredentialCacheService = {
      getAll: jest.fn().mockReturnValue([]),
      findCredentialsByDcqlQuery: jest.fn().mockReturnValue([]),
      findCredentialsByScope: jest.fn().mockReturnValue([]),
      status: jest.fn().mockReturnValue('loaded'),
      credentials: jest.fn().mockReturnValue([]),
      snapshot: jest.fn().mockReturnValue({ status: 'loaded', credentials: [] }),
      patchStatus: jest.fn(),
      remove: jest.fn(),
    };

    mockWalletService = {
      refreshCredentials: jest.fn().mockReturnValue(of([])),
      getAllVCs: jest.fn().mockReturnValue(of([])),
      updateCredentialStatus: jest.fn().mockReturnValue(of(null)),
    };

    mockToastServiceHandler = {
      showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(of(undefined)),
      showToast: jest.fn(),
      showErrorAlert: jest.fn().mockReturnValue(of(undefined)),
    };

    TestBed.overrideComponent(CredentialsPage, {
      add: { providers: [{ provide: ModalController, useValue: mockModalController }] },
    });

    await TestBed.configureTestingModule({
      // TranslateModule.forRoot() only needed once the translate="no" shielding tests
      // below render app-vc-view, which transitively injects TranslateService — every
      // other test in this spec never renders the template.
      imports: [CredentialsPage, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: mockRouter },
        // EMPTY prevents the constructor's queryParams subscription from emitting synchronously,
        // which would trigger cdr.detectChanges() before Angular's view is initialized.
        { provide: ActivatedRoute, useValue: { queryParams: EMPTY } },
        { provide: AuthorizationRequestService, useValue: mockAuthorizationRequestService },
        { provide: CredentialCacheService, useValue: mockCredentialCacheService },
        { provide: ToastServiceHandler, useValue: mockToastServiceHandler },
        { provide: LoaderService, useValue: { addLoadingProcess: jest.fn(), removeLoadingProcess: jest.fn() } },
        { provide: WalletService, useValue: mockWalletService },
        { provide: StorageService, useValue: {} },
        { provide: CameraLogsService, useValue: { addCameraLog: jest.fn() } },
        { provide: CredentialPreviewBuilderService, useValue: { buildPreview: jest.fn() } },
        { provide: CredentialDecisionService, useValue: { showDecisionDialog: jest.fn(), showTempMessage: jest.fn() } },
        { provide: IssuerNotificationService, useValue: { notifyIssuer: jest.fn().mockReturnValue(of(null)) } },
        { provide: IssuerMetadataCacheService, useValue: { registerIssuance: jest.fn().mockResolvedValue(undefined) } },
        { provide: ActivityService, useValue: { log: jest.fn() } },
        { provide: HapticService, useValue: { notification: jest.fn() } },
        { provide: CredentialVerificationService, useValue: { isRevoked: jest.fn().mockResolvedValue('not-revoked') } },
        { provide: Oid4vciEngineService, useValue: { performOid4vciFlow: jest.fn() } },
        { provide: ModalController, useValue: mockModalController },
        // privacyBlur() is only exercised by the translate="no" shielding tests below,
        // which render the card-grid (app-vc-view needs it for [blurred]) — every other
        // test in this spec never renders the template.
        { provide: UserPreferencesService, useValue: { privacyBlur: jest.fn().mockReturnValue(false) } },
        // Likewise only needed once app-vc-view actually renders.
        {
          provide: CredentialDisplayService,
          useValue: {
            getCardFields: jest.fn().mockResolvedValue([]),
            getDisplayName: jest.fn().mockResolvedValue('Test Credential'),
            getFormatLabel: jest.fn().mockReturnValue(''),
            getDetailSections: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CredentialsPage);
    component = fixture.componentInstance;
    mockHaptic = TestBed.inject(HapticService);
  });

  describe('when no valid VCs are found (selectableVcList.length === 0 after filter)', () => {
    beforeEach(() => {
      // Only REVOKED VC → after filter, selectableVcList.length === 0
      mockCredentialCacheService.getAll.mockReturnValue([mockRevokedVc]);
    });

    it('should navigate to /tabs/credentials', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials']);
    }));

    it('should show error alert after navigation completes', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel)
        .toHaveBeenCalledWith('errors.no-credentials-available');
    }));

    it('should not navigate to /tabs/vc-selector', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockRouter.navigate).not.toHaveBeenCalledWith(
        ['/tabs/vc-selector/'],
        expect.any(Object)
      );
    }));
  });

  describe('when at least one valid VC is found', () => {
    beforeEach(() => {
      // One VALID VC → selectableVcList.length === 1 after filter
      mockCredentialCacheService.getAll.mockReturnValue([mockValidVc]);
    });

    it('should navigate to /tabs/vc-selector', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/tabs/vc-selector/'],
        expect.objectContaining({ queryParams: expect.any(Object) })
      );
    }));
  });

  describe('when the credential load fails (status === error)', () => {
    beforeEach(() => {
      // refreshCredentials completes but the store ends in 'error'
      mockCredentialCacheService.status.mockReturnValue('error');
      mockCredentialCacheService.getAll.mockReturnValue([mockValidVc]);
    });

    it('should show a load error, NOT "no credentials available"', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel)
        .toHaveBeenCalledWith('errors.loading-VCs');
      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel)
        .not.toHaveBeenCalledWith('errors.no-credentials-available');
    }));

    it('should not attempt to filter credentials or navigate to vc-selector', fakeAsync(() => {
      (component as any).verifiablePresentationFlow(vpQrCode);
      tick();

      expect(mockAuthorizationRequestService.parseAuthorizationRequestFromQr).not.toHaveBeenCalled();
      expect(mockRouter.navigate).not.toHaveBeenCalledWith(
        ['/tabs/vc-selector/'],
        expect.any(Object)
      );
    }));
  });

  // AC-10 / NFR-S-142-08 / EC-09 (EUD-142, AD-4): the app-vc-view host itself is marked
  // non-translatable, reinforcing the component's own credential-card shielding — and
  // this must coexist with the privacy blur (EC-09: orthogonal, blur is CSS-only, never
  // touches translate state).
  describe('translate="no" shielding on the credential grid (AC-10, NFR-S-142-08, EC-09)', () => {
    it('marks the app-vc-view host as non-translatable', () => {
      mockCredentialCacheService.credentials.mockReturnValue([mockValidVc]);
      fixture.detectChanges();

      const host = fixture.nativeElement.querySelector('.card-grid app-vc-view');
      expect(host.getAttribute('translate')).toBe('no');
    });

    it('keeps the host non-translatable while the privacy blur is active (EC-09)', () => {
      // EC-09: blur is orthogonal CSS state on the card, not on translate — the two
      // must coexist without either one overriding the other.
      (TestBed.inject(UserPreferencesService).privacyBlur as unknown as jest.Mock).mockReturnValue(true);
      mockCredentialCacheService.credentials.mockReturnValue([mockValidVc]);
      fixture.detectChanges();

      const host = fixture.nativeElement.querySelector('.card-grid app-vc-view');
      expect(host.getAttribute('translate')).toBe('no');
      const vcView = fixture.debugElement.query(By.directive(VcViewComponent)).componentInstance as VcViewComponent;
      expect(vcView.blurred()).toBe(true);
    });
  });

  describe('ionViewWillEnter — display refresh guard (avoids overlap with protocol flows)', () => {
    function stubCdrAndSpyRefresh(): jest.SpyInstance {
      jest.spyOn(
        (component as unknown as { cdr: { detectChanges: () => void } }).cdr,
        'detectChanges'
      ).mockImplementation();
      return jest.spyOn(
        component as unknown as { refreshForDisplay: () => void },
        'refreshForDisplay'
      ).mockImplementation();
    }

    it('refreshes for display when no protocol flow is pending', () => {
      const refreshSpy = stubCdrAndSpyRefresh();

      component.ionViewWillEnter();

      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT refresh for display when a VP authorization request is pending', () => {
      const refreshSpy = stubCdrAndSpyRefresh();
      (component as unknown as { authorizationRequest: string }).authorizationRequest =
        'openid4vp://authorize?request_uri=x';

      component.ionViewWillEnter();

      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it('does NOT refresh for display when a credential offer is pending', () => {
      const refreshSpy = stubCdrAndSpyRefresh();
      component.credentialOfferUri = 'openid-credential-offer://x';

      component.ionViewWillEnter();

      expect(refreshSpy).not.toHaveBeenCalled();
    });
  });

  describe('checkCredentialStatuses — background revocation check', () => {
    const validVcWithStatusList: VerifiableCredential = {
      ...mockValidVc,
      credentialStatus: {
        id: 'status-1',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '3',
        statusListCredential: 'https://issuer.example.com/status-list/1',
      },
    } as any;

    let verificationService: { isRevoked: jest.Mock };

    beforeEach(() => {
      verificationService = TestBed.inject(CredentialVerificationService) as unknown as { isRevoked: jest.Mock };
      mockCredentialCacheService.snapshot.mockReturnValue({
        status: 'loaded',
        credentials: [validVcWithStatusList],
      });
    });

    it('should patch the credential to REVOKED when the check confirms revocation', async () => {
      // Arrange
      verificationService.isRevoked.mockResolvedValue('revoked');

      // Act
      await (component as unknown as { checkCredentialStatuses: () => Promise<void> }).checkCredentialStatuses();

      // Assert
      expect(mockCredentialCacheService.patchStatus).toHaveBeenCalledWith('vc-valid', 'REVOKED');
      expect(mockWalletService.updateCredentialStatus).toHaveBeenCalledWith('vc-valid', 'REVOKED');
    });

    it('should NOT change the cached status when the check cannot be completed (fail-closed, not fail-open)', async () => {
      // Arrange
      verificationService.isRevoked.mockResolvedValue('unknown');

      // Act
      await (component as unknown as { checkCredentialStatuses: () => Promise<void> }).checkCredentialStatuses();

      // Assert — this is the fail-open regression guard: a network failure must
      // never be silently treated as a confirmed "not revoked" credential.
      expect(mockCredentialCacheService.patchStatus).not.toHaveBeenCalled();
      expect(mockWalletService.updateCredentialStatus).not.toHaveBeenCalled();
    });

    it('should NOT change the cached status when the check confirms the credential is not revoked', async () => {
      // Arrange
      verificationService.isRevoked.mockResolvedValue('not-revoked');

      // Act
      await (component as unknown as { checkCredentialStatuses: () => Promise<void> }).checkCredentialStatuses();

      // Assert
      expect(mockCredentialCacheService.patchStatus).not.toHaveBeenCalled();
      expect(mockWalletService.updateCredentialStatus).not.toHaveBeenCalled();
    });
  });
});
