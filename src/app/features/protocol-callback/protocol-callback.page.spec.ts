import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ProtocolCallbackPage } from './protocol-callback.page';

class MockRouter {
  public navigate = jest.fn();
}

describe('ProtocolCallbackPage', () => {
  let component: ProtocolCallbackPage;
  let fixture: ComponentFixture<ProtocolCallbackPage>;
  let mockRouter: MockRouter;
  let queryParamsSubject: BehaviorSubject<Record<string, string>>;

  beforeEach(async () => {
    mockRouter = new MockRouter();
    queryParamsSubject = new BehaviorSubject<Record<string, string>>({});

    await TestBed.configureTestingModule({
      imports: [
        IonicModule.forRoot(),
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: { queryParams: queryParamsSubject }
        },
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
});
