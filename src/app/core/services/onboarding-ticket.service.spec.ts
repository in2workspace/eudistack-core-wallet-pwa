import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { OnboardingTicketService } from './onboarding-ticket.service';
import { UrlResolverService } from './url-resolver.service';

const SERVER = 'https://sandbox.example/business-wallet';
const BASE = `${SERVER}/api/v1/auth/onboarding-tickets`;
const OFFER = 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fo%2F1';

describe('OnboardingTicketService (EUD-315)', () => {
  let service: OnboardingTicketService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => SERVER } },
      ],
    });
    service = TestBed.inject(OnboardingTicketService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  describe('redeem', () => {
    it('posts the ticket and maps the answer of an email without account', async () => {
      const result = firstValueFrom(service.redeem('Zk3q9Xw2Lp7Rt4Vb8Nc1Ha'));
      const req = httpMock.expectOne(`${BASE}/redeem`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ ticket: 'Zk3q9Xw2Lp7Rt4Vb8Nc1Ha' });
      req.flush({ hasPasskeys: false, registrationTicket: 'rt_1', expiresIn: 300, credentialOffer: OFFER });

      await expect(result).resolves.toEqual({
        hasPasskeys: false,
        sessionOfAccount: false,
        registrationTicket: 'rt_1',
        expiresIn: 300,
        credentialOffer: OFFER,
      });
    });

    it('maps the answer of an account with passkeys and of a session of the account', async () => {
      const result = firstValueFrom(service.redeem('Zk3q9Xw2Lp7Rt4Vb8Nc1Ha'));
      httpMock.expectOne(`${BASE}/redeem`).flush({ hasPasskeys: true, sessionOfAccount: true });

      await expect(result).resolves.toEqual({
        hasPasskeys: true,
        sessionOfAccount: true,
        registrationTicket: null,
        expiresIn: 0,
        credentialOffer: null,
      });
    });

    it('drops an offer that is not by reference', async () => {
      const result = firstValueFrom(service.redeem('Zk3q9Xw2Lp7Rt4Vb8Nc1Ha'));
      httpMock.expectOne(`${BASE}/redeem`)
        .flush({ hasPasskeys: false, registrationTicket: 'rt_1', expiresIn: 300, credentialOffer: 'javascript:alert(1)' });

      expect((await result).credentialOffer).toBeNull();
    });

    it('errors with the service problem', async () => {
      const result = firstValueFrom(service.redeem('Zk3q9Xw2Lp7Rt4Vb8Nc1Ha'));
      httpMock.expectOne(`${BASE}/redeem`).flush({ type: 'invalid_ticket' }, { status: 401, statusText: 'Unauthorized' });

      await expect(result).rejects.toMatchObject({ status: 401 });
    });
  });

  describe('disavow', () => {
    it('posts the token and completes on 204', async () => {
      const result = firstValueFrom(service.disavow('a'.repeat(43)));
      const req = httpMock.expectOne(`${BASE}/disavowals`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: 'a'.repeat(43) });
      req.flush(null, { status: 204, statusText: 'No Content' });

      await expect(result).resolves.toBeUndefined();
    });
  });

  describe('access entry', () => {
    it('is read once', () => {
      expect(service.takeAccessEntry()).toBeNull();
      service.setAccessEntry('ticket-has-wallet');

      expect(service.takeAccessEntry()).toBe('ticket-has-wallet');
      expect(service.takeAccessEntry()).toBeNull();
    });
  });
});
