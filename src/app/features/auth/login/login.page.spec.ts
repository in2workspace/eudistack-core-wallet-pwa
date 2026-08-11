import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { NEVER, Observable, of, throwError } from 'rxjs';
import { LoginPage } from './login.page';
import { AuthService } from 'src/app/core/services/auth.service';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { PasskeyApiService } from 'src/app/core/services/passkey-api.service';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

describe('LoginPage (server mode)', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;

  let mockAuthService: {
    register: jest.Mock;
    verifyEmail: jest.Mock;
    refreshAccessToken: jest.Mock;
  };
  let mockPrfService: {
    hasPasskey: jest.Mock;
    createPasskey: jest.Mock;
    getCredentialId: jest.Mock;
  };
  let mockPasskeyStore: { getCredentialId: jest.Mock; hasPasskey: jest.Mock };
  let mockPasskeyApi: { registerPasskey: jest.Mock };
  let mockRouter: { navigateByUrl: jest.Mock };
  let mockWalletService: { syncCredentials: jest.Mock };
  let mockActivityService: { syncFromServer: jest.Mock };
  let mockCredentialCache: { setLoading: jest.Mock; setError: jest.Mock };
  let baseProviders: { provide: unknown; useValue: unknown }[];

  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();

    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {},
        getRandomValues: (buf: Uint8Array) => { buf.fill(0x42); return buf; },
      },
      configurable: true,
      writable: true,
    });

    mockAuthService = {
      register: jest.fn().mockReturnValue(of({ message: 'If the email is valid, you will receive a verification code.' })),
      verifyEmail: jest.fn().mockReturnValue(of({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 900 })),
      refreshAccessToken: jest.fn().mockReturnValue(of({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 900 })),
    };
    mockPrfService = {
      hasPasskey: jest.fn().mockReturnValue(false),
      createPasskey: jest.fn().mockResolvedValue('cred-local-1'),
      getCredentialId: jest.fn().mockReturnValue('cred-local-1'),
    };
    mockPasskeyStore = {
      getCredentialId: jest.fn().mockReturnValue('cred-local-1'),
      hasPasskey: jest.fn().mockReturnValue(true),
    };
    mockPasskeyApi = {
      registerPasskey: jest.fn().mockReturnValue(of({ id: 'p1', credentialId: 'cred-local-1', displayName: 'device' })),
    };
    mockRouter = { navigateByUrl: jest.fn() };
    mockWalletService = { syncCredentials: jest.fn().mockReturnValue(of(undefined)) };
    mockActivityService = { syncFromServer: jest.fn().mockResolvedValue(undefined) };
    mockCredentialCache = { setLoading: jest.fn(), setError: jest.fn() };

    baseProviders = [
      { provide: AuthService, useValue: mockAuthService },
      { provide: PasskeyPrfService, useValue: mockPrfService },
      { provide: PasskeyStoreService, useValue: mockPasskeyStore },
      { provide: PasskeyApiService, useValue: mockPasskeyApi },
      { provide: Router, useValue: mockRouter },
      {
        provide: ThemeService,
        useValue: {
          getLogoUrl: jest.fn().mockReturnValue('logo.png'),
          // brandName() now derives from this stream instead of reading `snapshot`.
          getTheme: jest.fn().mockReturnValue(of(null)),
        },
      },
      {
        provide: PwaInstallService,
        useValue: { installDecision$: of(false), isStandalone: false, promptInstall: jest.fn() }
      },
      { provide: WalletService, useValue: mockWalletService },
      { provide: ActivityService, useValue: mockActivityService },
      { provide: CredentialCacheService, useValue: mockCredentialCache },
    ];

    await TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot()],
      providers: baseProviders,
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
  });

  async function rebuildWithInstallDecision(decision: boolean, isStandalone = false): Promise<void> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot()],
      providers: baseProviders.map(provider => provider.provide === PwaInstallService
        ? {
            provide: PwaInstallService,
            useValue: { installDecision$: of(decision), isStandalone, promptInstall: jest.fn() },
          }
        : provider),
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
  }

  it('should create in server mode', () => {
    expect(component.isBrowserMode).toBe(false);
  });

  describe('AC-05: edited device name is sent to registerPasskey', () => {
    it('sends the edited displayName when confirming passkey registration', async () => {
      component.step.set('passkey');
      component.needsPasskeySetup = true;
      component.deviceName = 'My Custom Laptop';

      await component.createPasskeyForDevice();

      expect(mockPasskeyApi.registerPasskey).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'My Custom Laptop', credentialId: 'cred-local-1' })
      );
    });
  });

  describe('EC-04: device name defaults when the user does not edit it', () => {
    it('prefills deviceName after verifyCode() and registers with that default', async () => {
      component.email = 'user@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.step()).toBe('passkey');
      expect(component.needsPasskeySetup).toBe(true);
      expect(component.deviceName).toBeTruthy();

      const prefilledName = component.deviceName;
      await component.createPasskeyForDevice();

      expect(mockPasskeyApi.registerPasskey).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: prefilledName })
      );
    });
  });

  describe('EC-05: resuming with a refresh token but no local passkey', () => {
    it('routes straight to the passkey step, skipping email/OTP', () => {
      localStorage.setItem('wallet_refresh_token', 'stored-refresh-token');
      mockPrfService.hasPasskey.mockReturnValue(false);

      component.ionViewWillEnter();

      expect(component.step()).toBe('passkey');
      expect(component.needsPasskeySetup).toBe(true);
      expect(component.deviceName).toBeTruthy();
      expect(mockAuthService.register).not.toHaveBeenCalled();
      expect(mockAuthService.verifyEmail).not.toHaveBeenCalled();
    });

    it('goes to the email step when there is no refresh token', () => {
      component.ionViewWillEnter();

      expect(component.step()).toBe('email');
      expect(component.needsPasskeySetup).toBe(false);
    });
  });

  describe('ES-04: recoverable error on register()/verifyEmail() failure', () => {
    it('shows an error and stays on the email step when register() fails', () => {
      mockAuthService.register.mockReturnValue(throwError(() => ({ status: 500, error: {} })));
      component.email = 'user@example.com';

      component.sendCode();

      expect(component.step()).toBe('email');
      expect(component.errorMessage).toBeTruthy();
      expect(component.loading).toBe(false);
    });

    it('shows the neutral rate-limit message when register() returns 429', () => {
      mockAuthService.register.mockReturnValue(throwError(() => ({ status: 429 })));
      component.email = 'user@example.com';

      component.sendCode();

      expect(component.errorMessage).toBeTruthy();
      expect(component.loading).toBe(false);
    });

    it('shows an error and stays on the code step when verifyEmail() fails', () => {
      mockAuthService.verifyEmail.mockReturnValue(throwError(() => ({ status: 401, error: { message: 'invalid_code' } })));
      component.step.set('code');
      component.email = 'user@example.com';
      component.otpValue = '000000';

      component.verifyCode();

      expect(component.step()).toBe('code');
      expect(component.errorMessage).toBeTruthy();
      expect(component.loading).toBe(false);
    });
  });

  describe('ES-05 / AD-1: passkey server-side registration failure', () => {
    it('does not navigate and surfaces an error when registerPasskey() fails', async () => {
      mockPasskeyApi.registerPasskey.mockReturnValue(throwError(() => ({ status: 500 })));
      component.deviceName = 'My Device';

      await component.createPasskeyForDevice();

      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
      expect(component.errorMessage).toBeTruthy();
      expect(component.loading).toBe(false);
    });

    it('allows a retry that succeeds after a prior failure', async () => {
      mockPasskeyApi.registerPasskey
        .mockReturnValueOnce(throwError(() => ({ status: 500 })))
        .mockReturnValueOnce(of({ id: 'p1', credentialId: 'cred-local-1', displayName: 'My Device' }));
      component.deviceName = 'My Device';

      await component.createPasskeyForDevice();
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

      await component.createPasskeyForDevice();
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });

    it('does not navigate home before the server-side registration resolves (AD-1 ordering)', async () => {
      let resolveRegister!: (value: unknown) => void;
      mockPasskeyApi.registerPasskey.mockReturnValue(new Observable(subscriber => {
        resolveRegister = (value) => { subscriber.next(value); subscriber.complete(); };
      }));
      component.deviceName = 'My Device';

      const pending = component.createPasskeyForDevice();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

      resolveRegister({ id: 'p1', credentialId: 'cred-local-1', displayName: 'My Device' });
      await pending;

      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });
  });

  // EUD-104 traceability note: AC-03 (editable device name) and EC-02 (default name) are
  // already exercised above by 'AC-05: edited device name...' and 'EC-04: device name
  // defaults...' respectively — those EUD-103 test names predate this Story, but the
  // assertions are the same ones EUD-104 needs (the frontend can't distinguish a first vs.
  // second device; needsPasskeySetup is purely local state). Same for ES-02, fully covered
  // by 'ES-05 / AD-1: passkey server-side registration failure' below.
  describe('EUD-104 EC-01: no navigation before a passkey is actually registered', () => {
    it('stays on the passkey-setup screen and does not navigate home right after verify', () => {
      component.email = 'user@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.needsPasskeySetup).toBe(true);
      expect(component.step()).toBe('passkey');
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('R-1: existing-passkey verification path (needsPasskeySetup = false) is unaffected', () => {
    it('authenticates locally and navigates home on success', async () => {
      const mockCredentialsGet = jest.fn().mockResolvedValue({});
      Object.defineProperty(globalThis.navigator, 'credentials', {
        value: { get: mockCredentialsGet },
        configurable: true,
        writable: true,
      });
      component.needsPasskeySetup = false;

      await component.verifyPasskey();

      expect(mockCredentialsGet).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });
  });

  describe('credential sync coordination on login', () => {
    beforeEach(() => {
      const mockCredentialsGet = jest.fn().mockResolvedValue({});
      Object.defineProperty(globalThis.navigator, 'credentials', {
        value: { get: mockCredentialsGet },
        configurable: true,
        writable: true,
      });
      component.needsPasskeySetup = false;
    });

    it('marks the store as loading before navigating', async () => {
      await component.verifyPasskey();

      expect(mockCredentialCache.setLoading).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });

    it('does NOT block navigation on the sync for a normal login (no deep link)', async () => {
      await component.verifyPasskey();

      // Fire-and-forget sync path; navigation happens regardless.
      expect(mockWalletService.syncCredentials).toHaveBeenCalled();
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });

    it('AWAITS the sync before navigating when a protocol deep link is pending', async () => {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?authorizationRequest=xyz');

      let resolveSync!: () => void;
      mockWalletService.syncCredentials.mockReturnValue(
        new Observable<void>(sub => { resolveSync = () => { sub.next(); sub.complete(); }; })
      );

      const pending = component.verifyPasskey();
      await Promise.resolve();
      await Promise.resolve();

      // Navigation is held until the credential sync completes.
      expect(mockRouter.navigateByUrl).not.toHaveBeenCalled();

      resolveSync();
      await pending;

      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });

    it('sets the store to error (not stuck loading) and still navigates when the awaited sync fails', async () => {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?authorizationRequest=xyz');
      mockWalletService.syncCredentials.mockReturnValue(throwError(() => new Error('server down')));

      await component.verifyPasskey();

      expect(mockCredentialCache.setError).toHaveBeenCalled();
      // navigation is not blocked by the failure — the page then surfaces the error state
      expect(mockRouter.navigateByUrl).toHaveBeenCalled();
    });
  });

  describe('verification-code resend cooldown', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      component.email = 'user@example.com';
    });

    afterEach(() => {
      component.ngOnDestroy();
      jest.useRealTimers();
    });

    it('starts a 3-minute cooldown once the code has been sent', () => {
      component.sendCode();

      expect(component.step()).toBe('code');
      expect(component.resendSecondsLeft()).toBe(180);
      expect(component.resendCountdown()).toBe('03:00');
    });

    it('counts down and formats the remaining time as mm:ss', () => {
      component.sendCode();

      jest.advanceTimersByTime(61_000);

      expect(component.resendSecondsLeft()).toBe(119);
      expect(component.resendCountdown()).toBe('01:59');
    });

    it('ignores a resend request while the cooldown is still running', () => {
      component.sendCode();
      expect(mockAuthService.register).toHaveBeenCalledTimes(1);

      component.resendCode();

      expect(mockAuthService.register).toHaveBeenCalledTimes(1);
    });

    it('requests a new code and restarts the cooldown once it has elapsed', () => {
      component.sendCode();
      jest.advanceTimersByTime(180_000);
      expect(component.resendSecondsLeft()).toBe(0);

      component.otpValue = '123456';
      component.resendCode();

      expect(mockAuthService.register).toHaveBeenCalledTimes(2);
      expect(component.resendSecondsLeft()).toBe(180);
      // the stale code the user may have typed is cleared
      expect(component.otpValue).toBe('');
    });

    it('does not leave the cooldown running after leaving the code step', () => {
      component.sendCode();

      component.goBackToEmail();

      expect(component.resendSecondsLeft()).toBe(0);
      jest.advanceTimersByTime(5_000);
      expect(component.resendSecondsLeft()).toBe(0);
    });

    it('stops the cooldown once the code has been verified', () => {
      component.sendCode();
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.step()).toBe('passkey');
      expect(component.resendSecondsLeft()).toBe(0);
    });
  });

  describe('screen-driven presentation state', () => {
    it('picks the watermark that matches the current step', () => {
      component.step.set('email');
      expect(component.watermark()).toBe('email');

      component.step.set('code');
      expect(component.watermark()).toBe('verify');

      component.step.set('passkey');
      expect(component.watermark()).toBe('passkey');
    });

    it('shows the access screen and its watermark when the app is installable', async () => {
      await rebuildWithInstallDecision(true);

      expect(component.showInstallScreen()).toBe(true);
      expect(component.screen()).toBe('access');
      expect(component.watermark()).toBe('access');
    });

    it('does not fall back to the access watermark when the app is not installable', () => {
      expect(component.showInstallScreen()).toBe(true);

      expect(component.screen()).toBe('email');
      expect(component.watermark()).toBe('email');
    });

    it('renders nothing decorative until the installability probe settles', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [LoginPage, TranslateModule.forRoot()],
        providers: baseProviders.map(provider => provider.provide === PwaInstallService
          ? {
              provide: PwaInstallService,
              // never emits — mirrors the probe still running
              useValue: { installDecision$: NEVER, isStandalone: false, promptInstall: jest.fn() },
            }
          : provider),
      }).compileComponents();
      fixture = TestBed.createComponent(LoginPage);
      component = fixture.componentInstance;

      expect(component.screen()).toBe('checking');
      expect(component.watermark()).toBeNull();
      expect(component.canGoBack()).toBe(false);

      // Without a mask the element would paint its background-color in full.
      fixture.detectChanges();
      const watermark = fixture.nativeElement.querySelector('.auth-watermark') as HTMLElement;
      expect(watermark.style.display).toBe('none');
    });

    it('masks the watermark with the artwork of the current screen', () => {
      fixture.detectChanges();
      const watermark = fixture.nativeElement.querySelector('.auth-watermark') as HTMLElement;

      expect(watermark.getAttribute('data-shape')).toBe('email');
      expect(watermark.style.getPropertyValue('mask-image')).toContain('user-solid.svg');
      expect(watermark.style.getPropertyValue('mask-size')).toBe('contain');

      component.step.set('code');
      fixture.detectChanges();

      expect(watermark.style.getPropertyValue('mask-image')).toContain('envelope-circle-check-solid.svg');
      expect(watermark.style.display).toBe('');
    });

    it('falls back to a generic brand name when the tenant theme is unavailable', () => {
      expect(component.brandName()).toBe('Wallet');
    });

    it('offers a back affordance only on the OTP and passkey steps', () => {
      component.step.set('email');
      expect(component.canGoBack()).toBe(false);

      component.step.set('code');
      expect(component.canGoBack()).toBe(true);

      component.step.set('passkey');
      expect(component.canGoBack()).toBe(true);
    });
  });
});
