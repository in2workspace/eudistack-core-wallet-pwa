import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, ActivatedRoute } from '@angular/router';
import { EMPTY, of } from 'rxjs';
import { CredentialsPage } from './credentials.page';
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
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { StorageService } from 'src/app/shared/services/storage.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { VerifiableCredential } from 'src/app/core/models/verifiable-credential';

describe('CredentialsPage - verifiablePresentationFlow', () => {
  let component: CredentialsPage;
  let fixture: ComponentFixture<CredentialsPage>;
  let mockRouter: { navigate: jest.Mock };
  let mockAuthorizationRequestService: { parseAuthorizationRequestFromQr: jest.Mock };
  let mockCredentialCacheService: { getAll: jest.Mock; findCredentialsByDcqlQuery: jest.Mock; findCredentialsByScope: jest.Mock; syncFromBackend: jest.Mock };
  let mockToastServiceHandler: { showErrorAlertByTranslateLabel: jest.Mock; showToast: jest.Mock; showErrorAlert: jest.Mock };

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
      syncFromBackend: jest.fn(),
    };

    mockToastServiceHandler = {
      showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(of(undefined)),
      showToast: jest.fn(),
      showErrorAlert: jest.fn().mockReturnValue(of(undefined)),
    };

    await TestBed.configureTestingModule({
      imports: [CredentialsPage],
      providers: [
        { provide: Router, useValue: mockRouter },
        // EMPTY prevents the constructor's queryParams subscription from emitting synchronously,
        // which would trigger cdr.detectChanges() before Angular's view is initialized.
        { provide: ActivatedRoute, useValue: { queryParams: EMPTY } },
        { provide: AuthorizationRequestService, useValue: mockAuthorizationRequestService },
        { provide: CredentialCacheService, useValue: mockCredentialCacheService },
        { provide: ToastServiceHandler, useValue: mockToastServiceHandler },
        { provide: LoaderService, useValue: { addLoadingProcess: jest.fn(), removeLoadingProcess: jest.fn() } },
        { provide: WalletService, useValue: { getAllVCs: jest.fn().mockReturnValue(of([])), updateCredentialStatus: jest.fn().mockReturnValue(of(null)) } },
        { provide: StorageService, useValue: {} },
        { provide: CameraLogsService, useValue: { addCameraLog: jest.fn() } },
        { provide: CredentialPreviewBuilderService, useValue: { buildPreview: jest.fn() } },
        { provide: CredentialDecisionService, useValue: { showDecisionDialog: jest.fn(), showTempMessage: jest.fn() } },
        { provide: IssuerNotificationService, useValue: { notifyIssuer: jest.fn().mockReturnValue(of(null)) } },
        { provide: IssuerMetadataCacheService, useValue: { registerIssuance: jest.fn().mockResolvedValue(undefined) } },
        { provide: ActivityService, useValue: { log: jest.fn() } },
        { provide: HapticService, useValue: { notification: jest.fn() } },
        { provide: CredentialVerificationService, useValue: { isRevoked: jest.fn().mockResolvedValue(false) } },
        { provide: Oid4vciEngineService, useValue: { performOid4vciFlow: jest.fn() } },
        { provide: UserPreferencesService, useValue: {} },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CredentialsPage);
    component = fixture.componentInstance;
  });

  describe('when no valid VCs are found (validVcList.length === 0)', () => {
    beforeEach(() => {
      // Only REVOKED VC → after filter, validVcList.length === 0
      mockCredentialCacheService.getAll.mockReturnValue([mockRevokedVc]);
    });

    it('should navigate to /tabs/credentials', async () => {
      component.qrCodeEmit(vpQrCode);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials']);
    });

    it('should show error alert after navigation completes', async () => {
      component.qrCodeEmit(vpQrCode);
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel)
        .toHaveBeenCalledWith('errors.no-credentials-available');
    });

    it('should not navigate to /tabs/vc-selector', async () => {
      component.qrCodeEmit(vpQrCode);
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockRouter.navigate).not.toHaveBeenCalledWith(
        ['/tabs/vc-selector/'],
        expect.any(Object)
      );
    });
  });
});
