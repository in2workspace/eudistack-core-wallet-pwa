import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ProtocolCallbackPage } from './protocol-callback.page';

class MockRouter {
  public navigate = jest.fn().mockResolvedValue(true);
}

describe('ProtocolCallbackPage', () => {
  let component: ProtocolCallbackPage;
  let fixture: ComponentFixture<ProtocolCallbackPage>;
  let mockRouter: MockRouter;
  let queryParamsSubject: BehaviorSubject<Record<string, string>>;

  beforeEach(async () => {
    mockRouter = new MockRouter();
    queryParamsSubject = new BehaviorSubject<Record<string, string>>({});

    // Ensure default state: not in iframe, not in popup
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    Object.defineProperty(window, 'parent', { value: window, configurable: true });

    await TestBed.configureTestingModule({
      imports: [
        IonicModule.forRoot(),
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: { queryParams: queryParamsSubject } },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProtocolCallbackPage);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    Object.defineProperty(window, 'opener', { value: null, configurable: true });
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
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

  it('should post auth code to parent and not navigate when code+state are present and running in iframe', () => {
    const mockPostMessage = jest.fn();
    const mockParent = { postMessage: mockPostMessage };
    Object.defineProperty(window, 'parent', { value: mockParent, configurable: true });

    queryParamsSubject.next({ code: 'auth-code-123', state: 'state-abc' });
    fixture.detectChanges();

    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: 'oid4vci-auth-code', code: 'auth-code-123', state: 'state-abc' },
      window.location.origin
    );
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should post auth code to opener and close when code+state are present and running in popup', () => {
    const mockPostMessage = jest.fn();
    const mockClose = jest.fn();
    Object.defineProperty(window, 'opener', { value: { postMessage: mockPostMessage }, configurable: true });
    Object.defineProperty(window, 'close', { value: mockClose, configurable: true });

    queryParamsSubject.next({ code: 'auth-code-123', state: 'state-abc' });
    fixture.detectChanges();

    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: 'oid4vci-auth-code', code: 'auth-code-123', state: 'state-abc' },
      window.location.origin
    );
    expect(mockClose).toHaveBeenCalled();
    expect(mockRouter.navigate).not.toHaveBeenCalled();
  });

  it('should navigate to /tabs/home when code+state are present but not in iframe or popup', () => {
    queryParamsSubject.next({ code: 'auth-code-123', state: 'state-abc' });
    fixture.detectChanges();

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/home']);
  });
});