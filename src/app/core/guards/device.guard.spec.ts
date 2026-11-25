import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { deviceRegistrationGuard, registerDeviceRouteGuard } from './device.guard';
import { RemoteAuthService } from '../services/auth.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

describe('device guards (EUD-15 FR-06)', () => {
  let auth: { isInitialized$: () => BehaviorSubject<boolean>; isLoggedIn: jest.Mock; deviceReady: jest.Mock };
  let mode: 'server' | 'browser';

  function configure(): void {
    TestBed.configureTestingModule({
      providers: [
        { provide: RemoteAuthService, useValue: auth },
        { provide: WalletDiscoveryService, useValue: { mode: () => mode } },
        { provide: PasskeyStoreService, useValue: { hasPasskey: () => false } },
        { provide: Router, useValue: { parseUrl: (url: string) => ({ url } as unknown as UrlTree) } },
      ],
    });
  }

  function runDeviceGuard(url: string): Promise<unknown> {
    return TestBed.runInInjectionContext(() => deviceRegistrationGuard(
      {} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot) as Promise<unknown>);
  }

  function runRouteGuard(): Promise<unknown> {
    return TestBed.runInInjectionContext(() => registerDeviceRouteGuard(
      {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot) as Promise<unknown>);
  }

  beforeEach(() => {
    sessionStorage.clear();
    mode = 'server';
    const initialized = new BehaviorSubject(true);
    auth = {
      isInitialized$: () => initialized,
      isLoggedIn: jest.fn().mockReturnValue(true),
      deviceReady: jest.fn().mockResolvedValue('bound'),
    };
    configure();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lets a session bound to its device into the wallet', async () => {
    expect(await runDeviceGuard('/tabs/credentials')).toBe(true);
  });

  it('sends a session without device to "Registrar este dispositivo" and keeps the offer for later (AC-07)', async () => {
    auth.deviceReady.mockResolvedValue('unregistered');

    const result = await runDeviceGuard('/tabs/credentials?credential_offer_uri=x');

    expect(result).toEqual({ url: '/registrar-dispositivo' });
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/tabs/credentials?credential_offer_uri=x');
  });

  it('lets a temporary binding failure in (the next call binds again)', async () => {
    auth.deviceReady.mockResolvedValue('unavailable');

    expect(await runDeviceGuard('/tabs/credentials')).toBe(true);
  });

  it.each([
    '/tabs/scan',
    '/protocol/callback?credential_offer_uri=x',
    '/tabs/credentials?credential_offer_uri=x',
    '/tabs/credentials?request_uri=y',
  ])('postpones %s to the wallet home while the binding is retried (design §2.2)', async url => {
    auth.deviceReady.mockResolvedValue('unavailable');

    expect(await runDeviceGuard(url)).toEqual({ url: '/tabs/credentials' });
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(url);
  });

  it('leaves a user without session to authGuard', async () => {
    auth.isLoggedIn.mockReturnValue(false);

    expect(await runDeviceGuard('/tabs/devices')).toBe(true);
    expect(auth.deviceReady).not.toHaveBeenCalled();
  });

  it('does nothing in browser mode', async () => {
    mode = 'browser';

    expect(await runDeviceGuard('/tabs/credentials')).toBe(true);
    expect(auth.deviceReady).not.toHaveBeenCalled();
  });

  it('opens the registration route only for a session without device', async () => {
    auth.deviceReady.mockResolvedValue('unregistered');

    expect(await runRouteGuard()).toBe(true);
  });

  it('moves on to the saved link when the device is already bound', async () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/devices');

    expect(await runRouteGuard()).toEqual({ url: '/tabs/devices' });
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('sends a user without session to the access screen', async () => {
    auth.isLoggedIn.mockReturnValue(false);

    expect(await runRouteGuard()).toEqual({ url: '/auth/access' });
  });
});
