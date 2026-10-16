import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { AccessPage, hasEmailFormat, maskEmail } from './access.page';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { PasskeyCeremonyService, PrfCheckNeedsGestureError } from 'src/app/core/services/passkey-ceremony.service';
import { WebAuthnBrowserService } from 'src/app/core/services/webauthn-browser.service';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';
import { WalletAuthError } from 'src/app/core/models/error/WalletAuthError';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

function problem(status: number, type: string, headers?: HttpHeaders): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: { type, status }, headers });
}

describe('AccessPage (EUD-8)', () => {
  let fixture: ComponentFixture<AccessPage>;
  let page: AccessPage;
  let auth: {
    consumeSessionExpiredNotice: jest.Mock;
    signInWithPasskey: jest.Mock;
    registerPasskey: jest.Mock;
    requestEmailCode: jest.Mock;
    verifyEmailCode: jest.Mock;
    endOtherSessions: jest.Mock;
    leaveEmailFlow: jest.Mock;
    sessionDataReady: jest.Mock;
    completeRegistration: jest.Mock;
    serverLogoutPending: ReturnType<typeof signal<boolean>>;
  };
  let router: { navigateByUrl: jest.Mock };
  let supported: jest.Mock;
  let custody: jest.Mock;
  let installable$: BehaviorSubject<boolean>;
  let pwa: { installable$: unknown; isStandalone: boolean; isMacSafari: boolean; promptInstall: jest.Mock };
  let iosTab: jest.Mock;

  const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(AccessPage);
    page = fixture.componentInstance;
    page.ionViewWillEnter();
    await settle();
    fixture.detectChanges();
  }

  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    sessionStorage.clear();
    auth = {
      consumeSessionExpiredNotice: jest.fn().mockReturnValue(false),
      signInWithPasskey: jest.fn().mockResolvedValue(undefined),
      registerPasskey: jest.fn().mockResolvedValue(undefined),
      requestEmailCode: jest.fn().mockReturnValue(of(undefined)),
      verifyEmailCode: jest.fn().mockReturnValue(of({ hasPasskeys: false })),
      endOtherSessions: jest.fn().mockReturnValue(of(undefined)),
      leaveEmailFlow: jest.fn(),
      sessionDataReady: jest.fn().mockResolvedValue(undefined),
      completeRegistration: jest.fn(async (resume: () => Promise<unknown>) => { await resume(); }),
      serverLogoutPending: signal(false),
    };
    router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
    supported = jest.fn().mockResolvedValue(true);
    custody = jest.fn().mockReturnValue(false);
    installable$ = new BehaviorSubject(false);
    pwa = { installable$: installable$.asObservable(), isStandalone: false, isMacSafari: false, promptInstall: jest.fn().mockResolvedValue(true) };
    iosTab = jest.fn().mockReturnValue(false);

    await TestBed.configureTestingModule({
      imports: [AccessPage, TranslateModule.forRoot()],
      providers: [
        { provide: RemoteAuthService, useValue: auth },
        { provide: PasskeyCeremonyService, useValue: { hasPasskeyCustody: custody } },
        { provide: WebAuthnBrowserService, useValue: { isPasskeySupported: supported } },
        { provide: SupportChannelService, useValue: { channels: () => ({ helpCenterUrl: 'https://help.example', supportUrl: 'https://support.example' }) } },
        { provide: ThemeService, useValue: { getTheme: () => of(null) } },
        { provide: PwaInstallService, useValue: pwa },
        { provide: IosInstallService, useValue: { isIosSafariBrowserMode: iosTab } },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    page?.ngOnDestroy();
    jest.restoreAllMocks();
  });

  describe('Comprobación and Requisitos no cumplidos (FR-01)', () => {
    it('shows the requirements instead of the access when the browser has no passkeys', async () => {
      supported.mockResolvedValue(false);
      await create();

      expect(page.screen()).toBe('requirements');
      expect(text()).toContain('wallet-access.requirements.title');
      expect(text()).not.toContain('wallet-access.access.passkey-button');
    });

    it('opens the tenant help page from "More information"', async () => {
      supported.mockResolvedValue(false);
      const open = jest.spyOn(window, 'open').mockReturnValue(null);
      await create();

      page.openHelp();

      expect(open).toHaveBeenCalledWith('https://help.example', '_blank', 'noopener');
    });
  });

  describe('Acceso', () => {
    beforeEach(create);

    it('offers the passkey and the email entries', () => {
      expect(page.screen()).toBe('access');
      expect(text()).toContain('wallet-access.access.passkey-button');
      expect(text()).toContain('wallet-access.access.email-button');
    });

    it('signs in with the system picker and opens the wallet (FR-12)', async () => {
      await page.signInWithPasskey();

      expect(auth.signInWithPasskey).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('resumes a pending protocol link once the session attestations are loaded', async () => {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?authorizationRequest=x');

      await page.signInWithPasskey();

      expect(auth.sessionDataReady).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials?authorizationRequest=x');
    });

    it('stays on the screen with no message when the picker is cancelled', async () => {
      auth.signInWithPasskey.mockRejectedValue(new PasskeyError('passkey_cancelled', 'get'));

      await page.signInWithPasskey();

      expect(page.screen()).toBe('access');
      expect(page.errorMessage()).toBe('');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('goes to Acceso rechazado on a failed verification, and Reintentar comes back', async () => {
      auth.signInWithPasskey.mockRejectedValue(new WalletAuthError('authentication_failed'));

      await page.signInWithPasskey();
      expect(page.screen()).toBe('rejected');

      page.retryAfterRejection();
      expect(page.screen()).toBe('access');
    });

    it('goes to Passkey desconocida when the service does not know the passkey (FR-17)', async () => {
      auth.signInWithPasskey.mockRejectedValue(new WalletAuthError('unknown_credential'));

      await page.signInWithPasskey();

      expect(page.screen()).toBe('unknown-passkey');
    });

    it('shows a translated message for a real WebAuthn failure', async () => {
      auth.signInWithPasskey.mockRejectedValue(new PasskeyError('passkey_security', 'get'));

      await page.signInWithPasskey();

      expect(page.errorMessage()).toBe('auth.errors.passkey-security');
    });

    it('forgets a registration ticket from an earlier visit', () => {
      expect(auth.leaveEmailFlow).toHaveBeenCalled();
    });

    it('says when a logout could not be confirmed with the service yet', () => {
      auth.serverLogoutPending.set(true);
      fixture.detectChanges();

      expect(text()).toContain('wallet-access.access.logout-pending');
    });

    it('tells the user their session expired when they land here because of it (FR-18)', async () => {
      auth.consumeSessionExpiredNotice.mockReturnValue(true);
      page.ionViewWillEnter();
      await settle();
      fixture.detectChanges();

      expect(text()).toContain('wallet-access.access.session-expired');
    });
  });

  describe('install suggestion (FR-02)', () => {
    it('is hidden in a tab that cannot be installed', async () => {
      await create();

      expect(page.installSuggestion()).toBeNull();
      expect(text()).not.toContain('wallet-access.access.install-button');
    });

    it('launches the browser install prompt when the tab can be installed', async () => {
      installable$.next(true);
      await create();

      expect(text()).toContain('wallet-access.access.install-button');
      await page.install();
      expect(pwa.promptInstall).toHaveBeenCalled();
    });

    it('shows the add-to-home-screen steps on iOS, which cannot launch it', async () => {
      iosTab.mockReturnValue(true);
      await create();

      await page.install();

      expect(page.showIosSteps()).toBe(true);
      expect(pwa.promptInstall).not.toHaveBeenCalled();
    });

    it('is hidden in the installed app', async () => {
      pwa.isStandalone = true;
      installable$.next(true);
      await create();

      expect(page.installSuggestion()).toBeNull();
    });
  });

  describe('email flow', () => {
    beforeEach(async () => {
      await create();
      page.startEmailFlow();
    });

    it('enables "Send code" only for a well-formed email (FR-03)', () => {
      page.email.set('ana@');
      expect(page.canSendCode()).toBe(false);

      page.email.set('ana@example.com');
      expect(page.canSendCode()).toBe(true);
    });

    it('sends the code and shows the masked email', () => {
      page.email.set('ana@example.com');
      page.sendCode();
      fixture.detectChanges();

      expect(auth.requestEmailCode).toHaveBeenCalledWith('ana@example.com');
      expect(page.screen()).toBe('code');
      expect(page.maskedEmail()).toBe('a***@example.com');
    });

    it('shows the same rate-limit message whatever the email (FR-05, FR-06)', () => {
      auth.requestEmailCode.mockReturnValue(throwError(() => problem(429, 'rate_limited', new HttpHeaders({ 'Retry-After': '60' }))));
      page.email.set('ana@example.com');

      page.sendCode();

      expect(page.errorMessage()).toBe('wallet-access.email.rate-limited');
      expect(page.canSendCode()).toBe(false);
    });

    describe('code', () => {
      beforeEach(() => {
        page.email.set('ana@example.com');
        page.sendCode();
        page.onOtpChanged('123456');
      });

      it('goes to Crear passkey for an account without passkeys (FR-04)', () => {
        page.verifyCode();

        expect(auth.verifyEmailCode).toHaveBeenCalledWith('ana@example.com', '123456');
        expect(page.screen()).toBe('create-passkey');
      });

      it('goes to Elegir passkey for an account with passkeys (FR-09)', () => {
        auth.verifyEmailCode.mockReturnValue(of({ hasPasskeys: true }));

        page.verifyCode();

        expect(page.screen()).toBe('choose-passkey');
      });

      it('says the code is wrong', () => {
        auth.verifyEmailCode.mockReturnValue(throwError(() => problem(401, 'invalid_code')));

        page.verifyCode();

        expect(page.errorMessage()).toBe('wallet-access.code.invalid');
        expect(page.canSubmitCode()).toBe(true);
      });

      it.each([[401, 'expired_code'], [429, 'too_many_attempts']])(
        'asks for a new code after %s %s',
        (status, type) => {
          auth.verifyEmailCode.mockReturnValue(throwError(() => problem(status, type)));

          page.verifyCode();

          expect(page.errorMessage()).toBe('wallet-access.code.unusable');
          expect(page.canSubmitCode()).toBe(false);
        }
      );

      it('goes back to Email from "Change email"', () => {
        page.changeEmail();

        expect(page.screen()).toBe('email');
      });
    });

    it('back to Acceso forgets the ticket', () => {
      page.backToAccess();

      expect(auth.leaveEmailFlow).toHaveBeenCalled();
      expect(page.screen()).toBe('access');
    });
  });

  describe('Elegir passkey', () => {
    beforeEach(async () => {
      await create();
      auth.verifyEmailCode.mockReturnValue(of({ hasPasskeys: true }));
      page.startEmailFlow();
      page.email.set('ana@example.com');
      page.sendCode();
      page.onOtpChanged('123456');
      page.verifyCode();
    });

    it('signs in with a passkey of the account', async () => {
      await page.useAccountPasskey();

      expect(auth.signInWithPasskey).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('comes back here after a rejected attempt while the ticket is valid', async () => {
      auth.signInWithPasskey.mockRejectedValue(new WalletAuthError('authentication_failed'));

      await page.useAccountPasskey();
      page.retryAfterRejection();

      expect(page.screen()).toBe('choose-passkey');
    });

    it('restarts the email flow when the ticket expired', async () => {
      auth.signInWithPasskey.mockRejectedValue(new WalletAuthError('invalid_ticket'));

      await page.useAccountPasskey();

      expect(page.screen()).toBe('email');
      expect(page.errorMessage()).toBe('wallet-access.errors.ticket-expired');
      expect(auth.leaveEmailFlow).toHaveBeenCalled();
    });

    it('offers creating a new passkey', () => {
      page.createNewPasskey();

      expect(page.screen()).toBe('create-passkey');
    });
  });

  describe('Crear passkey', () => {
    async function reachCreate(hasPasskeys: boolean): Promise<void> {
      await create();
      auth.verifyEmailCode.mockReturnValue(of({ hasPasskeys }));
      page.startEmailFlow();
      page.email.set('ana@example.com');
      page.sendCode();
      page.onOtpChanged('123456');
      page.verifyCode();
      page.createNewPasskey();
      fixture.detectChanges();
    }

    it('always shows the shared-device tip, and no attestation warning on a new account', async () => {
      custody.mockReturnValue(true);
      await reachCreate(false);

      expect(text()).toContain('wallet-access.create-passkey.shared-device-tip');
      expect(text()).not.toContain('wallet-access.create-passkey.attestations-warning');
    });

    it('warns about the attestations only when the account had passkeys and the tenant has passkey custody', async () => {
      custody.mockReturnValue(true);
      await reachCreate(true);

      expect(text()).toContain('wallet-access.create-passkey.attestations-warning');
    });

    it('does not warn without passkey custody', async () => {
      await reachCreate(true);

      expect(text()).not.toContain('wallet-access.create-passkey.attestations-warning');
    });

    it('registers the passkey with the device name and opens the wallet for a first passkey', async () => {
      await reachCreate(false);
      page.deviceName.set('Work Mac');

      await page.createPasskey();

      expect(auth.registerPasskey).toHaveBeenCalledWith('Work Mac');
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('offers to close the other sessions after adding a passkey to an account that had one (FR-11)', async () => {
      await reachCreate(true);

      await page.createPasskey();

      expect(page.screen()).toBe('other-sessions');
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('goes to Passkey no compatible without PRF, and "Try another one" comes back (FR-08)', async () => {
      await reachCreate(false);
      auth.registerPasskey.mockRejectedValue(new WalletAuthError('passkey_prf_unsupported'));

      await page.createPasskey();
      expect(page.screen()).toBe('passkey-incompatible');

      page.retryWithOtherAuthenticator();
      expect(page.screen()).toBe('create-passkey');
    });

    it('stays with no message when the dialog is cancelled (FR-07)', async () => {
      await reachCreate(false);
      auth.registerPasskey.mockRejectedValue(new PasskeyError('passkey_cancelled', 'create'));

      await page.createPasskey();

      expect(page.screen()).toBe('create-passkey');
      expect(page.errorMessage()).toBe('');
    });

    it('asks for a tap to check the PRF when Safari dropped the gesture, and registers from that tap (FR-08)', async () => {
      await reachCreate(false);
      const resume = jest.fn().mockResolvedValue({});
      auth.registerPasskey.mockRejectedValue(new PrfCheckNeedsGestureError(resume));

      await page.createPasskey();
      expect(page.screen()).toBe('check-passkey');

      await page.checkCreatedPasskey();
      expect(auth.completeRegistration).toHaveBeenCalledWith(resume);
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('goes back to Crear passkey when the user cancels the tapped check', async () => {
      await reachCreate(false);
      auth.registerPasskey.mockRejectedValue(new PrfCheckNeedsGestureError(jest.fn()));
      auth.completeRegistration.mockRejectedValue(new PasskeyError('passkey_cancelled', 'get'));

      await page.createPasskey();
      await page.checkCreatedPasskey();

      expect(page.screen()).toBe('create-passkey');
    });

    it('says the registration failed when the service cannot verify it', async () => {
      await reachCreate(false);
      auth.registerPasskey.mockRejectedValue(new WalletAuthError('registration_failed'));

      await page.createPasskey();

      expect(page.errorMessage()).toBe('wallet-access.errors.registration-failed');
    });
  });

  describe('Otras sesiones', () => {
    beforeEach(async () => {
      await create();
      page['goTo']('other-sessions');
    });

    it('closes the other sessions and opens the wallet', async () => {
      page.closeOtherSessions();
      await settle();

      expect(auth.endOtherSessions).toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('keeps them and opens the wallet', async () => {
      page.keepOtherSessions();
      await settle();

      expect(auth.endOtherSessions).not.toHaveBeenCalled();
      expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('stays and says so when they could not be closed', () => {
      auth.endOtherSessions.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      page.closeOtherSessions();

      expect(page.screen()).toBe('other-sessions');
      expect(page.errorMessage()).toBe('wallet-access.other-sessions.failed');
    });
  });

  describe('accessibility (WCAG 2.1 AA)', () => {
    beforeEach(create);

    it('moves the focus to the heading of the new screen', async () => {
      jest.useFakeTimers();
      try {
        page.startEmailFlow();
        fixture.detectChanges();
        jest.runOnlyPendingTimers();

        expect(document.activeElement?.textContent).toContain('wallet-access.email.title');
      } finally {
        jest.useRealTimers();
      }
    });

    it('labels the email field through aria-labelledby', () => {
      page.startEmailFlow();
      fixture.detectChanges();

      const input = (fixture.nativeElement as HTMLElement).querySelector('#access-email')!;
      const label = (fixture.nativeElement as HTMLElement).querySelector(`#${input.getAttribute('aria-labelledby')}`);
      expect(label?.textContent).toContain('wallet-access.email.label');
    });

    it('moves the focus to the heading on first render too', async () => {
      jest.useFakeTimers();
      try {
        page.ionViewWillEnter();
        await settle();
        fixture.detectChanges();
        jest.runOnlyPendingTimers();

        expect(document.activeElement?.textContent).toContain('wallet-access.access.title');
      } finally {
        jest.useRealTimers();
      }
    });

    it('marks the current step of the email flow', () => {
      page.startEmailFlow();
      fixture.detectChanges();

      const current = (fixture.nativeElement as HTMLElement).querySelector('[aria-current="step"]');
      expect(current?.textContent).toContain('wallet-access.steps.email');
    });

    it('announces errors as alerts', async () => {
      auth.signInWithPasskey.mockRejectedValue(new PasskeyError('passkey_security', 'get'));
      await page.signInWithPasskey();
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent)
        .toContain('auth.errors.passkey-security');
    });
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('ana@dominio.es')).toBe('a***@dominio.es');
  });

  it('leaves a malformed value as is', () => {
    expect(maskEmail('ana')).toBe('ana');
  });
});

describe('hasEmailFormat', () => {
  it.each([
    'ana@dominio.es',
    'a@b.c',
    'ana.garcia+wallet@sub.dominio.es',
    'ana@dominio.es.',
    'ana@a.b.',
    'ana@-.-',
  ])('accepts %s', email => {
    expect(hasEmailFormat(email)).toBe(true);
  });

  it.each([
    '',
    'ana',
    '@dominio.es',
    'ana@',
    'ana@dominio',
    'ana@.es',
    'ana@dominio.',
    'ana@@dominio.es',
    'ana@dom@inio.es',
    'ana garcia@dominio.es',
    'ana@dominio.es	',
    'ana@.',
  ])('rejects %j', email => {
    expect(hasEmailFormat(email)).toBe(false);
  });
});
