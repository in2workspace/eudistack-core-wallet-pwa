import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { OnboardingTicketPage, TICKET_FREE_PATH } from './onboarding-ticket.page';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { WebAuthnBrowserService } from 'src/app/core/services/webauthn-browser.service';
import { RegistrationTicketService } from 'src/app/core/services/registration-ticket.service';
import { OnboardingTicketRedemption, OnboardingTicketService } from 'src/app/core/services/onboarding-ticket.service';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

const TICKET = 'Zk3q9Xw2Lp7Rt4Vb8Nc1Ha';
const OFFER = 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fcredential-offer%2F3f2a';
const OFFER_LINK = `/tabs/credentials?credential_offer_uri=${encodeURIComponent(OFFER)}`;

function problem(status: number, type: string): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { type, title: type, status } });
}

function redemption(overrides: Partial<OnboardingTicketRedemption>): OnboardingTicketRedemption {
  return {
    hasPasskeys: false,
    sessionOfAccount: false,
    registrationTicket: 'rt_9f2c4e1a7b',
    expiresIn: 300,
    credentialOffer: OFFER,
    ...overrides,
  };
}

describe('OnboardingTicketPage (EUD-315)', () => {
  let fixture: ComponentFixture<OnboardingTicketPage>;
  let page: OnboardingTicketPage;
  let router: { navigateByUrl: jest.Mock };
  let location: { replaceState: jest.Mock };
  let supported: jest.Mock;
  let mode: jest.Mock;
  let tickets: { redeem: jest.Mock; setAccessEntry: jest.Mock };
  let registrationTicket: RegistrationTicketService;
  let initialized$: BehaviorSubject<boolean>;
  let auth: {
    isInitialized$: () => unknown;
    isLoggedIn: jest.Mock;
    logout: jest.Mock;
    sessionDataReady: jest.Mock;
  };
  let ticketParam: string;

  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  async function open(): Promise<void> {
    fixture = TestBed.createComponent(OnboardingTicketPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
    await settle();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sessionStorage.clear();
    ticketParam = TICKET;
    router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
    location = { replaceState: jest.fn() };
    supported = jest.fn().mockResolvedValue(true);
    mode = jest.fn().mockReturnValue('server');
    tickets = { redeem: jest.fn().mockReturnValue(of(redemption({}))), setAccessEntry: jest.fn() };
    initialized$ = new BehaviorSubject(true);
    auth = {
      isInitialized$: () => initialized$.asObservable(),
      isLoggedIn: jest.fn().mockReturnValue(false),
      logout: jest.fn().mockReturnValue(of(undefined)),
      sessionDataReady: jest.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [OnboardingTicketPage, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: Location, useValue: location },
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { paramMap: convertToParamMap({ ticket: ticketParam }) } }) },
        { provide: WalletDiscoveryService, useValue: { mode } },
        { provide: WebAuthnBrowserService, useValue: { isPasskeySupported: supported } },
        { provide: OnboardingTicketService, useValue: tickets },
        { provide: RemoteAuthService, useValue: auth },
      ],
    }).compileComponents();
    registrationTicket = TestBed.inject(RegistrationTicketService);
  });

  afterEach(() => {
    registrationTicket.clear();
    jest.restoreAllMocks();
  });

  describe('the ticket leaves the browser (AC-04)', () => {
    it('replaces the address and its history entry before redeeming', async () => {
      tickets.redeem.mockImplementation(() => {
        expect(location.replaceState).toHaveBeenCalledWith(TICKET_FREE_PATH);
        return of(redemption({}));
      });
      await open();

      expect(location.replaceState).toHaveBeenCalledTimes(1);
      expect(location.replaceState.mock.calls[0][0]).not.toContain(TICKET);
      expect(tickets.redeem).toHaveBeenCalledWith(TICKET);
    });

    it('replaces the history entry on every navigation that follows', async () => {
      await open();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
    });
  });

  describe('email without account or without passkeys (AC-03, EC-01)', () => {
    it('keeps the registration ticket and the offer and goes to Crear passkey', async () => {
      await open();

      expect(registrationTicket.get()).toBe('rt_9f2c4e1a7b');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(OFFER_LINK);
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('ticket-create-passkey');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
    });

    it('resumes nothing when the ticket carries no offer (EC-05)', async () => {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?credential_offer_uri=old');
      tickets.redeem.mockReturnValue(of(redemption({ credentialOffer: null })));
      await open();

      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('ticket-create-passkey');
    });

    it('shows a temporary failure when the answer has no registration ticket', async () => {
      tickets.redeem.mockReturnValue(of(redemption({ registrationTicket: null })));
      await open();

      expect(page.state()).toBe('failed');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('email with an account with passkeys (AC-08)', () => {
    it('keeps the offer and goes to Acceso with the notice, with no registration ticket', async () => {
      tickets.redeem.mockReturnValue(of(redemption({ hasPasskeys: true, registrationTicket: null })));
      await open();

      expect(registrationTicket.get()).toBeNull();
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(OFFER_LINK);
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('ticket-has-wallet');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
    });
  });

  describe('session open (AC-09, EC-02)', () => {
    beforeEach(() => auth.isLoggedIn.mockReturnValue(true));

    it('waits for the start-up resume before redeeming', async () => {
      initialized$.next(false);
      await open();
      expect(tickets.redeem).not.toHaveBeenCalled();

      initialized$.next(true);
      await settle();

      expect(tickets.redeem).toHaveBeenCalledWith(TICKET);
    });

    it('resumes the offer at once when the session is of the ticket account', async () => {
      tickets.redeem.mockReturnValue(of(redemption({ sessionOfAccount: true, hasPasskeys: true, registrationTicket: null })));
      await open();

      expect(auth.logout).not.toHaveBeenCalled();
      expect(auth.sessionDataReady).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith(OFFER_LINK, { replaceUrl: true });
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
    });

    it('goes to the wallet home when the session is of the ticket account and there is no offer', async () => {
      tickets.redeem.mockReturnValue(of(redemption({ sessionOfAccount: true, hasPasskeys: true, registrationTicket: null, credentialOffer: null })));
      await open();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials', { replaceUrl: true });
    });

    it('closes a session of another account before keeping the registration ticket and the offer', async () => {
      auth.logout.mockImplementation(() => {
        expect(registrationTicket.get()).toBeNull();
        return of(undefined);
      });
      await open();

      expect(auth.logout).toHaveBeenCalled();
      expect(registrationTicket.get()).toBe('rt_9f2c4e1a7b');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(OFFER_LINK);
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('ticket-create-passkey');
    });
  });

  describe('invalid ticket (AC-06)', () => {
    it.each([
      ['401 invalid_ticket', problem(401, 'invalid_ticket')],
      ['400 invalid_request', problem(400, 'invalid_request')],
    ])('goes to Ticket no válido on %s', async (_label, err) => {
      tickets.redeem.mockReturnValue(throwError(() => err));
      await open();

      expect(tickets.setAccessEntry).toHaveBeenCalledWith('invalid-ticket');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
      expect(registrationTicket.get()).toBeNull();
    });

    it('does not call the service with a malformed ticket', async () => {
      ticketParam = 'not-a-ticket';
      await open();

      expect(tickets.redeem).not.toHaveBeenCalled();
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('invalid-ticket');
    });
  });

  describe('temporary failures', () => {
    it.each([
      ['offline', new HttpErrorResponse({ status: 0 }), 'errors.network-error'],
      ['rate limited', problem(429, 'rate_limited'), 'auth.errors.too-many-attempts'],
      ['server error', new HttpErrorResponse({ status: 503 }), 'wallet-access.errors.generic'],
    ])('keeps the ticket to retry when %s', async (_label, err, key) => {
      tickets.redeem.mockReturnValueOnce(throwError(() => err));
      await open();

      expect(page.state()).toBe('failed');
      expect(page.errorKey()).toBe(key);
      expect(text()).toContain(key);
      expect(router.navigateByUrl).not.toHaveBeenCalled();

      page.retry();
      await settle();

      expect(tickets.redeem).toHaveBeenLastCalledWith(TICKET);
      expect(tickets.setAccessEntry).toHaveBeenCalledWith('ticket-create-passkey');
    });

    it('offers the access screen from a failure', async () => {
      tickets.redeem.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      await open();

      page.goToAccess();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
    });
  });

  describe('preconditions', () => {
    it('does not redeem without passkey support: the access screen shows the requirements (EC-06)', async () => {
      supported.mockResolvedValue(false);
      await open();

      expect(tickets.redeem).not.toHaveBeenCalled();
      expect(tickets.setAccessEntry).not.toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
    });

    it('does not redeem in browser mode', async () => {
      mode.mockReturnValue('browser');
      await open();

      expect(tickets.redeem).not.toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/', { replaceUrl: true });
    });
  });
});
