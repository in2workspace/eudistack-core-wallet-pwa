import { TestBed } from '@angular/core/testing';
import { UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { authLandingGuard, iosInstallGuard, iosInstallRouteGuard } from './ios-install.guard';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { AuthService } from '../services/auth.service';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';

function runGuard(guardFn: typeof iosInstallGuard): any {
  return TestBed.runInInjectionContext(() => guardFn({} as any, {} as any));
}

describe('iosInstallGuard', () => {
  let iosInstall: jest.Mocked<Pick<IosInstallService, 'shouldShowInstallWizard' | 'wizardState'>>;
  let passkeyStore: jest.Mocked<Pick<PasskeyStoreService, 'hasPasskey'>>;

  beforeEach(() => {
    iosInstall = { shouldShowInstallWizard: jest.fn(), wizardState: jest.fn() };
    passkeyStore = { hasPasskey: jest.fn() };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: IosInstallService, useValue: iosInstall },
        { provide: PasskeyStoreService, useValue: passkeyStore },
      ],
    });
  });

  it('redirects to /ios-install?state=not-bootstrapped when the wizard applies and no passkey — AC-008.1', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(true);
    iosInstall.wizardState.mockReturnValue('not-bootstrapped');
    passkeyStore.hasPasskey.mockReturnValue(false);

    const result = runGuard(iosInstallGuard) as UrlTree;

    expect(result.toString()).toContain('/ios-install');
    expect(result.queryParams['state']).toBe('not-bootstrapped');
  });

  it('redirects to /ios-install?state=already-bootstrapped when passkey exists — AC-008.2 variant', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(true);
    iosInstall.wizardState.mockReturnValue('already-bootstrapped');
    passkeyStore.hasPasskey.mockReturnValue(true);

    const result = runGuard(iosInstallGuard) as UrlTree;

    expect(result.queryParams['state']).toBe('already-bootstrapped');
  });

  it('passes through when the wizard does not apply (server mode, dismissed, not iOS Safari or standalone)', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(false);

    expect(runGuard(iosInstallGuard)).toBe(true);
    expect(iosInstall.wizardState).not.toHaveBeenCalled();
  });
});

describe('authLandingGuard', () => {
  let iosInstall: jest.Mocked<Pick<IosInstallService, 'shouldShowInstallWizard' | 'wizardState' | 'isServerMode'>>;
  let passkeyStore: jest.Mocked<Pick<PasskeyStoreService, 'hasPasskey'>>;
  let authService: { isInitialized$: jest.Mock; isLoggedIn: jest.Mock };
  let initialized$: BehaviorSubject<boolean>;

  const runLanding = (url: string) =>
    TestBed.runInInjectionContext(() => authLandingGuard({} as any, { url } as any));

  beforeEach(() => {
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    iosInstall = { shouldShowInstallWizard: jest.fn(), wizardState: jest.fn(), isServerMode: jest.fn().mockReturnValue(false) };
    passkeyStore = { hasPasskey: jest.fn() };
    initialized$ = new BehaviorSubject(true);
    authService = { isInitialized$: jest.fn(() => initialized$.asObservable()), isLoggedIn: jest.fn().mockReturnValue(false) };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: IosInstallService, useValue: iosInstall },
        { provide: PasskeyStoreService, useValue: passkeyStore },
        { provide: AuthService, useValue: authService },
      ],
    });
  });

  describe('browser mode', () => {
    it('redirects to /ios-install with the wizard state when the wizard applies', () => {
      iosInstall.shouldShowInstallWizard.mockReturnValue(true);
      iosInstall.wizardState.mockReturnValue('not-bootstrapped');
      passkeyStore.hasPasskey.mockReturnValue(false);

      const result = runLanding('/') as UrlTree;

      expect(result.toString()).toContain('/ios-install');
      expect(result.queryParams['state']).toBe('not-bootstrapped');
    });

    it('redirects to /auth/register without a local passkey', () => {
      iosInstall.shouldShowInstallWizard.mockReturnValue(false);
      passkeyStore.hasPasskey.mockReturnValue(false);

      expect((runLanding('/') as UrlTree).toString()).toBe('/auth/register');
    });

    it('redirects to /auth/login with a local passkey', () => {
      iosInstall.shouldShowInstallWizard.mockReturnValue(false);
      passkeyStore.hasPasskey.mockReturnValue(true);

      expect((runLanding('/') as UrlTree).toString()).toBe('/auth/login');
    });

    it('stores the target URL as pending deep link unless it is the root or an auth route', () => {
      iosInstall.shouldShowInstallWizard.mockReturnValue(false);
      passkeyStore.hasPasskey.mockReturnValue(false);

      runLanding('/auth/login');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();

      runLanding('/tabs/credentials?x=1');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/tabs/credentials?x=1');
    });
  });

  describe('server mode (EUD-8)', () => {
    beforeEach(() => iosInstall.isServerMode.mockReturnValue(true));

    it('goes straight to the wallet when the start-up resume opened a session', async () => {
      authService.isLoggedIn.mockReturnValue(true);

      const result = await firstValueFrom(runLanding('/') as Observable<UrlTree>);

      expect(result.toString()).toBe('/tabs/credentials');
    });

    it('goes to the single access screen without a session, keeping the target as pending deep link', async () => {
      const result = await firstValueFrom(runLanding('/unknown?x=1') as Observable<UrlTree>);

      expect(result.toString()).toBe('/auth/access');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/unknown?x=1');
      expect(passkeyStore.hasPasskey).not.toHaveBeenCalled();
    });

    it('waits for the start-up resume before deciding', () => {
      initialized$.next(false);
      const decisions: UrlTree[] = [];

      (runLanding('/') as Observable<UrlTree>).subscribe(result => decisions.push(result));
      expect(decisions).toHaveLength(0);

      authService.isLoggedIn.mockReturnValue(true);
      initialized$.next(true);
      expect(decisions.map(tree => tree.toString())).toEqual(['/tabs/credentials']);
    });
  });
});

describe('iosInstallRouteGuard', () => {
  let iosInstall: jest.Mocked<Pick<IosInstallService, 'isIosSafariBrowserMode' | 'isServerMode'>>;

  beforeEach(() => {
    iosInstall = { isIosSafariBrowserMode: jest.fn(), isServerMode: jest.fn().mockReturnValue(false) };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [{ provide: IosInstallService, useValue: iosInstall }],
    });
  });

  it('redirects to / when not iOS Safari (prevents direct URL navigation)', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(false);

    expect((runGuard(iosInstallRouteGuard) as UrlTree).toString()).toBe('/');
  });

  it('redirects to / in server mode even on iOS Safari', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);
    iosInstall.isServerMode.mockReturnValue(true);

    expect((runGuard(iosInstallRouteGuard) as UrlTree).toString()).toBe('/');
  });

  it('allows access on iOS Safari browser mode in browser wallet mode', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);

    expect(runGuard(iosInstallRouteGuard)).toBe(true);
  });
});
