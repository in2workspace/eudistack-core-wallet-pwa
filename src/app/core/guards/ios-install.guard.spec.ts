import { TestBed } from '@angular/core/testing';
import { UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { authLandingGuard, iosInstallGuard, iosInstallRouteGuard } from './ios-install.guard';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { PasskeyStoreService } from '../services/passkey-store.service';

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
  let iosInstall: jest.Mocked<Pick<IosInstallService, 'shouldShowInstallWizard' | 'wizardState'>>;
  let passkeyStore: jest.Mocked<Pick<PasskeyStoreService, 'hasPasskey'>>;

  const runLanding = (url: string) =>
    TestBed.runInInjectionContext(() => authLandingGuard({} as any, { url } as any)) as UrlTree;

  beforeEach(() => {
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
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

  it('redirects to /ios-install with the wizard state when the wizard applies (browser mode)', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(true);
    iosInstall.wizardState.mockReturnValue('not-bootstrapped');
    passkeyStore.hasPasskey.mockReturnValue(false);

    const result = runLanding('/');

    expect(result.toString()).toContain('/ios-install');
    expect(result.queryParams['state']).toBe('not-bootstrapped');
  });

  it('redirects to /auth/register without passkey when the wizard does not apply (server mode)', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(false);
    passkeyStore.hasPasskey.mockReturnValue(false);

    expect(runLanding('/').toString()).toBe('/auth/register');
  });

  it('redirects to /auth/login with passkey when the wizard does not apply', () => {
    iosInstall.shouldShowInstallWizard.mockReturnValue(false);
    passkeyStore.hasPasskey.mockReturnValue(true);

    expect(runLanding('/').toString()).toBe('/auth/login');
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
