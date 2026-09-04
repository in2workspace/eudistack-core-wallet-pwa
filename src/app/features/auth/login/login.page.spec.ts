import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Observable, of, Subject, throwError } from 'rxjs';
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
  let mockPasskeyApi: { registerPasskey: jest.Mock; listPasskeys: jest.Mock };
  let mockRouter: { navigateByUrl: jest.Mock };
  let mockWalletService: { syncCredentials: jest.Mock };
  let mockActivityService: { syncFromServer: jest.Mock };
  let mockCredentialCache: { setLoading: jest.Mock; setError: jest.Mock };

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
      listPasskeys: jest.fn().mockReturnValue(of([])),
    };
    mockRouter = { navigateByUrl: jest.fn() };
    mockWalletService = { syncCredentials: jest.fn().mockReturnValue(of(undefined)) };
    mockActivityService = { syncFromServer: jest.fn().mockResolvedValue(undefined) };
    mockCredentialCache = { setLoading: jest.fn(), setError: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [LoginPage, TranslateModule.forRoot()],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: PasskeyPrfService, useValue: mockPrfService },
        { provide: PasskeyStoreService, useValue: mockPasskeyStore },
        { provide: PasskeyApiService, useValue: mockPasskeyApi },
        { provide: Router, useValue: mockRouter },
        { provide: ThemeService, useValue: { getLogoUrl: jest.fn().mockReturnValue('logo.png') } },
        {
          provide: PwaInstallService,
          useValue: { installDecision$: of(false), isStandalone: false, promptInstall: jest.fn() }
        },
        { provide: WalletService, useValue: mockWalletService },
        { provide: ActivityService, useValue: mockActivityService },
        { provide: CredentialCacheService, useValue: mockCredentialCache },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
  });

  it('should create in server mode', () => {
    expect(component.isBrowserMode).toBe(false);
  });

  describe('AC-05: edited device name is sent to registerPasskey', () => {
    it('sends the edited displayName when confirming passkey registration', async () => {
      component.step = 'passkey';
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

      expect(component.step).toBe('passkey');
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

      expect(component.step).toBe('passkey');
      expect(component.needsPasskeySetup).toBe(true);
      expect(component.deviceName).toBeTruthy();
      expect(mockAuthService.register).not.toHaveBeenCalled();
      expect(mockAuthService.verifyEmail).not.toHaveBeenCalled();
    });

    it('goes to the email step when there is no refresh token', () => {
      component.ionViewWillEnter();

      expect(component.step).toBe('email');
      expect(component.needsPasskeySetup).toBe(false);
    });
  });

  describe('TECH-DEBT #1046140: needsPasskeySetup must not trust a stale local flag from another account', () => {
    it('forces device registration when the account has no server-side passkeys, even if the browser has a local one', () => {
      mockPrfService.hasPasskey.mockReturnValue(true);
      mockPasskeyApi.listPasskeys.mockReturnValue(of([]));
      component.email = 'new-account@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(mockPasskeyApi.listPasskeys).toHaveBeenCalled();
      expect(component.needsPasskeySetup).toBe(true);
      expect(component.step).toBe('passkey');
      expect(component.deviceName).toBeTruthy();
    });

    it('does not force setup when this device\'s local credentialId matches one of the account\'s server-side passkeys', () => {
      mockPasskeyApi.listPasskeys.mockReturnValue(of([
        { id: 'p1', credentialId: 'cred-local-1', displayName: 'This Laptop', createdAt: '', lastUsedAt: null, activeSessions: 1 }
      ]));
      component.email = 'existing-account@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.needsPasskeySetup).toBe(false);
      expect(component.step).toBe('passkey');
    });

    it('forces setup when the account has other passkeys but none match this device\'s local credentialId', () => {
      mockPasskeyApi.listPasskeys.mockReturnValue(of([
        { id: 'p1', credentialId: 'cred-on-phone', displayName: 'Phone', createdAt: '', lastUsedAt: null, activeSessions: 1 }
      ]));
      component.email = 'existing-account@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.needsPasskeySetup).toBe(true);
      expect(component.step).toBe('passkey');
      expect(component.deviceName).toBeTruthy();
    });

    it('forces setup when this device has no local credentialId at all, even if the account has server-side passkeys', () => {
      mockPrfService.getCredentialId.mockReturnValue(null);
      mockPasskeyApi.listPasskeys.mockReturnValue(of([
        { id: 'p1', credentialId: 'cred-on-phone', displayName: 'Phone', createdAt: '', lastUsedAt: null, activeSessions: 1 }
      ]));
      component.email = 'existing-account@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.needsPasskeySetup).toBe(true);
      expect(component.step).toBe('passkey');
    });

    it('fails safe to needsPasskeySetup=true when listPasskeys() errors', () => {
      mockPasskeyApi.listPasskeys.mockReturnValue(throwError(() => ({ status: 500 })));
      component.email = 'user@example.com';
      component.otpValue = '123456';

      component.verifyCode();

      expect(component.needsPasskeySetup).toBe(true);
      expect(component.step).toBe('passkey');
      expect(component.loading).toBe(false);
    });
  });

  describe('ES-04: recoverable error on register()/verifyEmail() failure', () => {
    it('shows an error and stays on the email step when register() fails', () => {
      mockAuthService.register.mockReturnValue(throwError(() => ({ status: 500, error: {} })));
      component.email = 'user@example.com';

      component.sendCode();

      expect(component.step).toBe('email');
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
      component.step = 'code';
      component.email = 'user@example.com';
      component.otpValue = '000000';

      component.verifyCode();

      expect(component.step).toBe('code');
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
      expect(component.step).toBe('passkey');
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

  describe('Initialization watchdog (structured loader / friendly timeout on stuck installDecision$)', () => {
    let pendingInstallDecision$: Subject<boolean>;

    beforeEach(() => {
      pendingInstallDecision$ = new Subject<boolean>();
      (component.pwaInstall as unknown as { installDecision$: Observable<boolean> }).installDecision$ = pendingInstallDecision$;
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
  });
});
