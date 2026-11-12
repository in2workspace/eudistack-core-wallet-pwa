import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { NOT_ME_TOKEN_FREE_PATH, NotMePage } from './not-me.page';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { OnboardingTicketService } from 'src/app/core/services/onboarding-ticket.service';
import { AuthService, RemoteAuthService } from 'src/app/core/services/auth.service';

const TOKEN = 'k3J9xP2mQ7vR4tW8yB1nC5dF6gH0jL2aS3eU4iO7pZ9';

describe('NotMePage (EUD-315)', () => {
  let fixture: ComponentFixture<NotMePage>;
  let page: NotMePage;
  let router: { navigateByUrl: jest.Mock };
  let location: { replaceState: jest.Mock };
  let mode: jest.Mock;
  let disavow: jest.Mock;
  let tokenParam: string;
  let auth: { isLoggedIn: jest.Mock; refreshAccessToken: jest.Mock };

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  function open(): void {
    fixture = TestBed.createComponent(NotMePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    tokenParam = TOKEN;
    router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
    location = { replaceState: jest.fn() };
    mode = jest.fn().mockReturnValue('server');
    disavow = jest.fn().mockReturnValue(of(undefined));
    auth = { isLoggedIn: jest.fn().mockReturnValue(false), refreshAccessToken: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [NotMePage, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: Location, useValue: location },
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { fragment: tokenParam } }) },
        { provide: WalletDiscoveryService, useValue: { mode } },
        { provide: OnboardingTicketService, useValue: { disavow } },
        // The page never starts a session nor asks for a passkey (AC-10): it may only check, after
        // the disavowal, whether the session of its tab survived (EC-17). Anything else would throw.
        { provide: AuthService, useFactory: () => { throw new Error('AuthService must not be used'); } },
        { provide: RemoteAuthService, useFactory: () => auth },
      ],
    }).compileComponents();
  });

  afterEach(() => jest.restoreAllMocks());

  it('asks for confirmation without calling the service and removes the token from the URL', () => {
    open();

    expect(page.screen()).toBe('confirm');
    expect(text()).toContain('wallet-access.not-me.title');
    expect(text()).toContain('wallet-access.not-me.body');
    expect(location.replaceState).toHaveBeenCalledWith(NOT_ME_TOKEN_FREE_PATH);
    expect(disavow).not.toHaveBeenCalled();
  });

  it('disavows on confirm and shows the result with a button to Acceso (AC-10)', async () => {
    open();

    await page.confirm();
    fixture.detectChanges();

    expect(disavow).toHaveBeenCalledWith(TOKEN);
    expect(page.screen()).toBe('done');
    expect(text()).toContain('wallet-access.not-me.done');

    page.goToAccess();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
  });

  describe('tab with a session (EC-17)', () => {
    beforeEach(() => auth.isLoggedIn.mockReturnValue(true));

    it('forgets a session of the disavowed account: its renewal is rejected', async () => {
      auth.refreshAccessToken.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 401 })));
      open();

      await page.confirm();

      expect(auth.refreshAccessToken).toHaveBeenCalledWith({ onAuthFailure: 'clear-only' });
      expect(page.screen()).toBe('done');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('keeps a session of another account: its renewal is accepted', async () => {
      auth.refreshAccessToken.mockReturnValue(of({ accessToken: 'a', expiresIn: 300 }));
      open();

      await page.confirm();

      expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(page.screen()).toBe('done');
    });

    it('does not check any session before the holder confirms, nor when the disavowal fails', async () => {
      disavow.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      open();
      expect(auth.refreshAccessToken).not.toHaveBeenCalled();

      await page.confirm();

      expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    });
  });

  it('checks no session when the tab has none', async () => {
    open();

    await page.confirm();

    expect(auth.refreshAccessToken).not.toHaveBeenCalled();
    expect(page.screen()).toBe('done');
  });

  it('says the link is no longer valid on 401 invalid_token (AC-10)', async () => {
    disavow.mockReturnValue(throwError(() =>
      new HttpErrorResponse({ status: 401, error: { type: 'invalid_token', title: 'x', status: 401 } })));
    open();

    await page.confirm();
    fixture.detectChanges();

    expect(page.screen()).toBe('invalid');
    expect(text()).toContain('wallet-access.not-me.invalid');
  });

  it('says the link is no longer valid for a malformed token, without calling the service', () => {
    tokenParam = 'short';
    open();

    expect(page.screen()).toBe('invalid');
    expect(disavow).not.toHaveBeenCalled();
  });

  it('cancels without calling the service (EC-10)', () => {
    open();

    page.cancel();

    expect(disavow).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/', { replaceUrl: true });
  });

  it.each([
    ['offline', new HttpErrorResponse({ status: 0 }), 'errors.network-error'],
    ['rate limited', new HttpErrorResponse({ status: 429, error: { type: 'rate_limited' } }), 'auth.errors.too-many-attempts'],
    ['server error', new HttpErrorResponse({ status: 503 }), 'wallet-access.errors.generic'],
  ])('stays on the confirmation with an alert when %s, and can retry', async (_label, err, key) => {
    disavow.mockReturnValueOnce(throwError(() => err));
    open();

    await page.confirm();
    fixture.detectChanges();

    expect(page.screen()).toBe('confirm');
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain(key);

    await page.confirm();
    expect(disavow).toHaveBeenLastCalledWith(TOKEN);
    expect(page.screen()).toBe('done');
  });

  it('does nothing in browser mode', () => {
    mode.mockReturnValue('browser');
    open();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/', { replaceUrl: true });
    expect(disavow).not.toHaveBeenCalled();
  });
});
