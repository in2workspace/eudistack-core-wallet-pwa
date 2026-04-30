import { TestBed } from '@angular/core/testing';
import { UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { iosInstallGuard, iosInstallRouteGuard } from './ios-install.guard';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PasskeyStoreService } from '../services/passkey-store.service';

function runGuard(guardFn: typeof iosInstallGuard): any {
  return TestBed.runInInjectionContext(() => guardFn({} as any, {} as any));
}

describe('iosInstallGuard', () => {
  let iosInstall: jest.Mocked<IosInstallService>;
  let passkeyStore: jest.Mocked<Pick<PasskeyStoreService, 'hasPasskey'>>;

  beforeEach(() => {
    iosInstall = {
      isIosSafariBrowserMode: jest.fn(),
      isDismissed: jest.fn(),
      wizardState: jest.fn(),
      dismissOnboarding: jest.fn(),
    } as any;

    passkeyStore = { hasPasskey: jest.fn() };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: IosInstallService, useValue: iosInstall },
        { provide: PasskeyStoreService, useValue: passkeyStore },
      ],
    });
  });

  it('redirects to /ios-install?state=not-bootstrapped on iOS Safari without passkey — AC-008.1', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);
    iosInstall.isDismissed.mockReturnValue(false);
    iosInstall.wizardState.mockReturnValue('not-bootstrapped');
    passkeyStore.hasPasskey.mockReturnValue(false);

    const result = runGuard(iosInstallGuard) as UrlTree;
    expect(result.toString()).toContain('/ios-install');
    expect(result.queryParams['state']).toBe('not-bootstrapped');
  });

  it('redirects to /ios-install?state=already-bootstrapped when passkey exists — AC-008.2 variant', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);
    iosInstall.isDismissed.mockReturnValue(false);
    iosInstall.wizardState.mockReturnValue('already-bootstrapped');
    passkeyStore.hasPasskey.mockReturnValue(true);

    const result = runGuard(iosInstallGuard) as UrlTree;
    expect(result.queryParams['state']).toBe('already-bootstrapped');
  });

  it('passes through when wizard is dismissed — AC-008.7', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);
    iosInstall.isDismissed.mockReturnValue(true);

    expect(runGuard(iosInstallGuard)).toBe(true);
  });

  it('passes through on Android Chrome — AC-008.6', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(false);
    iosInstall.isDismissed.mockReturnValue(false);

    expect(runGuard(iosInstallGuard)).toBe(true);
  });

  it('passes through when standalone (no iOS browser mode) — AC-008.5', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(false);

    expect(runGuard(iosInstallGuard)).toBe(true);
  });
});

describe('iosInstallRouteGuard', () => {
  let iosInstall: jest.Mocked<Pick<IosInstallService, 'isIosSafariBrowserMode'>>;

  beforeEach(() => {
    iosInstall = { isIosSafariBrowserMode: jest.fn() };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [{ provide: IosInstallService, useValue: iosInstall }],
    });
  });

  it('redirects to / when not iOS Safari (prevents direct URL navigation)', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() =>
      iosInstallRouteGuard({} as any, {} as any)
    ) as UrlTree;
    expect(result.toString()).toBe('/');
  });

  it('allows access on iOS Safari browser mode', () => {
    iosInstall.isIosSafariBrowserMode.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() =>
      iosInstallRouteGuard({} as any, {} as any)
    );
    expect(result).toBe(true);
  });
});
