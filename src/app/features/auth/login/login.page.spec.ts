import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, of, Subject } from 'rxjs';
import { LoginPage } from './login.page';
import { AuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { PasskeyError } from 'src/app/core/models/error/PasskeyError';

/**
 * LoginPage is the browser-mode access screen (local passkey, no Wallet Unit
 * Service). Server mode uses AccessPage (EUD-8): see access.page.spec.ts.
 */
describe('LoginPage (browser mode)', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;

  let mockAuthService: { markAuthenticated: jest.Mock; setupPasskey: jest.Mock; getToken: jest.Mock };
  let mockPrfService: { hasPasskey: jest.Mock; assertLocalPasskey: jest.Mock };
  let mockRouter: { navigateByUrl: jest.Mock };
  let baseProviders: { provide: unknown; useValue: unknown }[];

  beforeEach(async () => {
    sessionStorage.clear();

    mockAuthService = {
      markAuthenticated: jest.fn(),
      setupPasskey: jest.fn().mockResolvedValue(undefined),
      getToken: jest.fn().mockReturnValue(''),
    };
    mockPrfService = {
      hasPasskey: jest.fn().mockReturnValue(false),
      assertLocalPasskey: jest.fn().mockResolvedValue(undefined),
    };
    mockRouter = { navigateByUrl: jest.fn() };

    baseProviders = [
      { provide: AuthService, useValue: mockAuthService },
      { provide: PasskeyPrfService, useValue: mockPrfService },
      { provide: Router, useValue: mockRouter },
      {
        provide: ThemeService,
        useValue: {
          getLogoUrl: jest.fn().mockReturnValue('logo.png'),
          getTheme: jest.fn().mockReturnValue(of(null)),
        },
      },
      {
        provide: PwaInstallService,
        useValue: { installDecision$: of(false), isStandalone: false, promptInstall: jest.fn() }
      },
    ];

    await TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot()],
      providers: baseProviders,
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
  });

  async function rebuildWithInstallDecision(
    decision: boolean,
    isStandalone = false,
    isMacSafari = false
  ): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot()],
      providers: baseProviders.map(provider => provider.provide === PwaInstallService
        ? {
            provide: PwaInstallService,
            useValue: { installDecision$: of(decision), isStandalone, isMacSafari, promptInstall: jest.fn() },
          }
        : provider),
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
  }

  it('creates the wallet passkey and goes home', async () => {
    await component.createWalletBrowserMode();

    expect(mockAuthService.setupPasskey).toHaveBeenCalled();
    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
  });

  it('marks the session authenticated after the local passkey check', async () => {
    await component.loginBrowserMode();

    expect(mockPrfService.assertLocalPasskey).toHaveBeenCalled();
    expect(mockAuthService.markAuthenticated).toHaveBeenCalled();
  });

  it('resumes a pending deep link after signing in', async () => {
    sessionStorage.setItem('wallet_pending_deep_link', '/tabs/vc-selector?x=1');

    await component.loginBrowserMode();

    expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/vc-selector?x=1');
  });

  describe('macOS Safari install guidance (access screen)', () => {
    const accessScreen = (): HTMLElement => {
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    it('keeps both options side by side, so install and continue-in-browser read as parallel choices', async () => {
      await rebuildWithInstallDecision(true, false, true);
      const el = accessScreen();

      expect(el.querySelector('.auth-link-button')!.textContent).toContain('auth.register.continue-browser');
      expect(el.querySelector('.auth-button--access')!.textContent).toContain('auth.access.continue-wallet');
    });

    it('keeps the steps out of the main screen until the user asks to install', async () => {
      await rebuildWithInstallDecision(true, false, true);

      expect(component.showMacStepsModal).toBe(false);
      expect(accessScreen().querySelectorAll('.auth-steps__item')).toHaveLength(0);
    });

    it('opens the steps instead of a prompt Safari cannot show', async () => {
      await rebuildWithInstallDecision(true, false, true);
      accessScreen().querySelector<HTMLButtonElement>('.auth-button--access')!.click();

      expect(component.showMacStepsModal).toBe(true);
    });

    it('still triggers the native prompt on browsers that do fire beforeinstallprompt', async () => {
      await rebuildWithInstallDecision(true, false, false);
      const promptInstall = TestBed.inject(PwaInstallService).promptInstall as jest.Mock;
      accessScreen().querySelector<HTMLButtonElement>('.auth-button--access')!.click();

      expect(promptInstall).toHaveBeenCalled();
      expect(component.showMacStepsModal).toBe(false);
    });
  });

  describe('Passkey prompt outcomes (cancel / timeout / real failures)', () => {
    let consoleError: jest.SpyInstance;

    beforeEach(() => {
      // spyOn returns the spy an earlier test may have left on console.error: reset its calls.
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      consoleError.mockClear();
    });

    function loginRejectsWith(error: unknown): void {
      jest.spyOn(component as any, 'authenticateLocally').mockRejectedValue(error);
    }

    it('logs in and navigates home when the passkey is confirmed', async () => {
      jest.spyOn(component as any, 'authenticateLocally').mockResolvedValue(undefined);

      await component.loginBrowserMode();

      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
      expect(component.errorMessage).toBe('');
      expect(component.noticeMessage).toBe('');
    });

    it('treats a dismissed prompt as a notice, not an error', async () => {
      loginRejectsWith(new PasskeyError('passkey_cancelled', 'get'));

      await component.loginBrowserMode();

      expect(component.noticeMessage).toBe('auth.errors.passkey-login-cancelled');
      expect(component.errorMessage).toBe('');
    });

    it('does not log a user cancellation as an error', async () => {
      loginRejectsWith(new PasskeyError('passkey_cancelled', 'get'));

      await component.loginBrowserMode();

      expect(consoleError).not.toHaveBeenCalled();
    });

    it('leaves the button enabled so the user can retry after cancelling', async () => {
      loginRejectsWith(new PasskeyError('passkey_cancelled', 'get'));

      await component.loginBrowserMode();

      expect(component.loading).toBe(false);
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });

    it('clears the cancel notice when the retry succeeds', async () => {
      loginRejectsWith(new PasskeyError('passkey_cancelled', 'get'));
      await component.loginBrowserMode();
      jest.spyOn(component as any, 'authenticateLocally').mockResolvedValue(undefined);

      await component.loginBrowserMode();

      expect(component.noticeMessage).toBe('');
      expect(mockRouter.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('shows the timeout notice without logging it', async () => {
      loginRejectsWith(new PasskeyError('passkey_timeout', 'get'));

      await component.loginBrowserMode();

      expect(component.noticeMessage).toBe('auth.errors.passkey-timeout');
      expect(consoleError).not.toHaveBeenCalled();
    });

    it('shows and logs a real WebAuthn failure (SecurityError)', async () => {
      const failure = new PasskeyError('passkey_security', 'get');
      loginRejectsWith(failure);

      await component.loginBrowserMode();

      expect(component.errorMessage).toBe('auth.errors.passkey-security');
      expect(consoleError).toHaveBeenCalledWith('[LoginPage] Passkey ceremony failed:', failure);
    });

    it('never shows the raw DOMException text for an unexpected error', async () => {
      loginRejectsWith(new Error('The operation either timed out or was not allowed.'));

      await component.loginBrowserMode();

      expect(component.errorMessage).toBe('auth.errors.passkey-failed');
    });

    it('uses the creation-specific notice when the user cancels creating the passkey', async () => {
      mockAuthService.setupPasskey.mockRejectedValue(new PasskeyError('passkey_cancelled', 'create'));

      await component.createWalletBrowserMode();

      expect(component.noticeMessage).toBe('auth.errors.passkey-creation-cancelled');
    });

    it('renders the cancel notice in an <output> live region (not an alert)', async () => {
      loginRejectsWith(new PasskeyError('passkey_cancelled', 'get'));
      await component.loginBrowserMode();

      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('output.error-box--notice')?.textContent)
        .toContain('auth.errors.passkey-login-cancelled');
      expect(host.querySelector('[role="alert"]')).toBeNull();
    });
  });

  describe('Help modal and view events', () => {
    it('covers openHelp and closeHelp', () => {
      component.openHelp();
      expect(component.showHelpModal).toBe(true);
      component.closeHelp();
      expect(component.showHelpModal).toBe(false);
    });

    it('covers ionViewWillLeave and ngOnDestroy', () => {
      const clearSpy = jest.spyOn(component as any, 'clearInitWatchdog');
      component.ionViewWillLeave();
      expect(clearSpy).toHaveBeenCalled();
      component.ngOnDestroy();
      expect(clearSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Initialization watchdog (structured loader / friendly timeout on stuck installDecision$)', () => {
    let pendingInstallDecision$: Subject<boolean>;

    beforeEach(async () => {
      pendingInstallDecision$ = new Subject<boolean>();
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LoginPage, TranslateModule.forRoot()],
        providers: baseProviders.map(provider => provider.provide === PwaInstallService
          ? {
              provide: PwaInstallService,
              // never emits on its own — the watchdog tests drive it manually via .next()
              useValue: { installDecision$: pendingInstallDecision$, isStandalone: false, promptInstall: jest.fn() },
            }
          : provider),
      }).compileComponents();

      fixture = TestBed.createComponent(LoginPage);
      component = fixture.componentInstance;
    });

    it('starts with neither the slow message nor the error screen showing', () => {
      component.ionViewWillEnter();

      expect(component.initTakingLong()).toBe(false);
      expect(component.initFailed()).toBe(false);
    });

    it('shows the "taking longer" message once the slow threshold elapses without resolving', fakeAsync(() => {
      component.ionViewWillEnter();

      tick(2999);
      expect(component.initTakingLong()).toBe(false);

      tick(1);
      expect(component.initTakingLong()).toBe(true);
      expect(component.initFailed()).toBe(false);

      pendingInstallDecision$.next(false);
      tick(0);
    }));

    it('shows the friendly error screen once the fail threshold elapses without installDecision$ ever resolving', fakeAsync(() => {
      component.ionViewWillEnter();

      tick(7999);
      expect(component.initFailed()).toBe(false);

      tick(1);
      expect(component.initFailed()).toBe(true);

      pendingInstallDecision$.next(false);
      tick(0);
    }));

    it('never shows the error screen when installDecision$ resolves before the fail threshold', fakeAsync(() => {
      component.ionViewWillEnter();

      tick(3500);
      pendingInstallDecision$.next(false);
      tick(8000);

      expect(component.initFailed()).toBe(false);
    }));

    it('retryInit() clears the error screen and re-arms the watchdog', fakeAsync(() => {
      component.ionViewWillEnter();
      tick(8000);
      expect(component.initFailed()).toBe(true);

      component.retryInit();

      expect(component.initFailed()).toBe(false);
      expect(component.initTakingLong()).toBe(false);

      pendingInstallDecision$.next(false);
      tick(0);
    }));

    it('retryInit() actually leaves the "checking" screen when installDecision$ never settles (W1: re-arming alone cannot recover, since installDecision$ is a shareReplay a fresh subscription cannot restart)', fakeAsync(() => {
      component.ionViewWillEnter();
      tick(8000);
      expect(component.initFailed()).toBe(true);
      expect(component.screen()).toBe('checking');

      component.retryInit();

      // Proceeds as if installDecision$ had resolved to false, without a page reload.
      expect(component.screen()).not.toBe('checking');
      expect(component.screen()).toBe('browser');

      pendingInstallDecision$.next(false);
      tick(0);
    }));

    it('reloadApp() reloads the page as the guaranteed manual fallback', () => {
      const originalLocation = window.location;
      const reloadSpy = jest.fn();
      // jsdom's window.location.reload is read-only — swap the whole object for the spy.
      delete (window as unknown as { location?: Location }).location;
      (window as unknown as { location: Location }).location = { ...originalLocation, reload: reloadSpy } as Location;

      component.reloadApp();

      expect(reloadSpy).toHaveBeenCalled();

      (window as unknown as { location: Location }).location = originalLocation;
    });

    it('stops the watchdog timers on ionViewWillLeave so a stale timeout cannot flip the signals after leaving (W2)', fakeAsync(() => {
      component.ionViewWillEnter();
      tick(1000);

      component.ionViewWillLeave();
      tick(8000);

      expect(component.initTakingLong()).toBe(false);
      expect(component.initFailed()).toBe(false);
    }));

    it('stops the watchdog timers on ngOnDestroy (W2)', fakeAsync(() => {
      component.ionViewWillEnter();
      tick(1000);

      component.ngOnDestroy();
      tick(8000);

      expect(component.initTakingLong()).toBe(false);
      expect(component.initFailed()).toBe(false);
    }));
  });

  describe('screen-driven presentation state', () => {
    it('shows the access screen and its watermark when the app is installable', async () => {
      await rebuildWithInstallDecision(true);

      expect(component.showInstallScreen()).toBe(true);
      expect(component.screen()).toBe('access');
      expect(component.watermark()).toBe('access');
    });

    it('goes straight to the passkey screen when the app is not installable', () => {
      expect(component.screen()).toBe('browser');
      expect(component.watermark()).toBe('passkey');
    });

    it('renders nothing decorative until the installability probe settles', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LoginPage, TranslateModule.forRoot()],
        providers: baseProviders.map(provider => provider.provide === PwaInstallService
          ? {
              provide: PwaInstallService,
              // never emits: mirrors the probe still running
              useValue: { installDecision$: NEVER, isStandalone: false, promptInstall: jest.fn() },
            }
          : provider),
      }).compileComponents();
      fixture = TestBed.createComponent(LoginPage);
      component = fixture.componentInstance;

      expect(component.screen()).toBe('checking');
      expect(component.watermark()).toBeNull();

      // Without a mask the element would paint its background-color in full.
      fixture.detectChanges();
      const watermark = fixture.nativeElement.querySelector('.auth-watermark') as HTMLElement;
      expect(watermark.style.display).toBe('none');
    });

    it('masks the watermark with the artwork of the current screen', () => {
      fixture.detectChanges();
      const watermark = fixture.nativeElement.querySelector('.auth-watermark') as HTMLElement;

      expect(watermark.getAttribute('data-shape')).toBe('passkey');
      expect(watermark.style.getPropertyValue('mask-image')).toContain('door-open-solid.svg');
      expect(watermark.style.getPropertyValue('mask-size')).toBe('contain');
    });

    it('falls back to a generic brand name when the tenant theme is unavailable', () => {
      expect(component.brandName()).toBe('Wallet');
    });

    it('offers to sign in with the local passkey when there is one, and to create it otherwise', async () => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('auth.passkey.register-button');

      mockPrfService.hasPasskey.mockReturnValue(true);
      await rebuildWithInstallDecision(false);
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).toContain('auth.login.passkey-button');
    });
  });
});
