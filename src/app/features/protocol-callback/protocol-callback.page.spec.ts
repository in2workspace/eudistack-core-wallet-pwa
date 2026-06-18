import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { ProtocolCallbackPage } from './protocol-callback.page';
import { Oid4vciEngineService } from 'src/app/core/protocol/oid4vci/oid4vci.engine.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CredentialPreviewBuilderService } from 'src/app/core/services/credential-preview-builder.service';
import { CredentialDecisionService } from 'src/app/core/services/credential-decision.service';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { IssuerNotificationService } from 'src/app/core/services/issuer-notification.service';
import { IssuerMetadataCacheService } from 'src/app/core/services/issuer-metadata-cache.service';
import { ActivityService } from 'src/app/core/services/activity.service';

class MockRouter {
  public navigate = jest.fn().mockResolvedValue(true);
}

describe('ProtocolCallbackPage', () => {
  let component: ProtocolCallbackPage;
  let fixture: ComponentFixture<ProtocolCallbackPage>;
  let mockRouter: MockRouter;
  let queryParamsSubject: BehaviorSubject<Record<string, string>>;
  let mockOid4vciEngineService: jest.Mocked<Pick<Oid4vciEngineService, 'resumeAuthCodeFlow'>>;

  beforeEach(async () => {
    mockRouter = new MockRouter();
    queryParamsSubject = new BehaviorSubject<Record<string, string>>({});
    mockOid4vciEngineService = { resumeAuthCodeFlow: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [
        IonicModule.forRoot(),
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { queryParams: queryParamsSubject } },
        { provide: Oid4vciEngineService, useValue: mockOid4vciEngineService },
        { provide: WalletService, useValue: { finalizeCredentialIssuance: jest.fn().mockReturnValue(of(null)) } },
        { provide: CredentialPreviewBuilderService, useValue: { buildPreview: jest.fn().mockReturnValue({}) } },
        { provide: CredentialDecisionService, useValue: { showDecisionDialog: jest.fn(), showTempMessage: jest.fn() } },
        { provide: ToastServiceHandler, useValue: { showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(of(null)) } },
        { provide: IssuerNotificationService, useValue: { notifyIssuer: jest.fn().mockReturnValue(of(null)) } },
        { provide: IssuerMetadataCacheService, useValue: { registerIssuance: jest.fn().mockResolvedValue(undefined) } },
        { provide: ActivityService, useValue: { log: jest.fn() } },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProtocolCallbackPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should navigate to /tabs/credentials with credentialOfferUri when credential_offer_uri param is present', () => {
    queryParamsSubject.next({ credential_offer_uri: 'https://issuer.example.com/offer/123' });
    fixture.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { credentialOfferUri: 'https://issuer.example.com/offer/123' },
    });
  });

  it('should navigate to /tabs/credentials with authorizationRequest when authorization_request param is present', () => {
    queryParamsSubject.next({ authorization_request: 'openid4vp://?client_id=did:key:z6Mk&request_uri=https://verifier/auth' });
    fixture.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { authorizationRequest: 'openid4vp://?client_id=did:key:z6Mk&request_uri=https://verifier/auth' },
    });
  });

  it('should prioritize credential_offer_uri over authorization_request when both are present', () => {
    queryParamsSubject.next({
      credential_offer_uri: 'https://issuer.example.com/offer/123',
      authorization_request: 'openid4vp://test'
    });
    fixture.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { credentialOfferUri: 'https://issuer.example.com/offer/123' },
    });
  });

  it('should navigate to /tabs/home when no recognized query param is present', () => {
    queryParamsSubject.next({});
    fixture.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/home']);
  });

  it('should call resumeAuthCodeFlow with code and state when both params are present', async () => {
    mockOid4vciEngineService.resumeAuthCodeFlow.mockResolvedValue({
      credentialResponseWithStatus: {
        statusCode: 200,
        status: 200,
        credentialResponse: { credentials: [], notification_id: undefined },
      },
      issuerMetadata: {
        credentialIssuer: 'https://issuer.example.com',
        credential_configurations_supported: {},
        notification_endpoint: undefined,
      },
      tokenResponse: { access_token: 'token', token_type: 'Bearer' },
      authorisationServerMetadata: {},
      tokenObtainedAt: 0,
      format: 'vc+sd-jwt',
      credentialConfigurationId: 'PDA1',
    } as any);

    queryParamsSubject.next({ code: 'auth-code-123', state: 'state-abc' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockOid4vciEngineService.resumeAuthCodeFlow).toHaveBeenCalledWith('auth-code-123', 'state-abc');
  });
});