import { TestBed } from '@angular/core/testing';
import { UrlTree } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { firstValueFrom, Observable, of } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { accessRouteGuard, browserModeAuthRouteGuard } from './access.guard';
import { authGuard } from './auth.guard';

describe('auth route guards (EUD-8)', () => {
  let mode: 'server' | 'browser';
  let authService: { isInitialized$: jest.Mock; isLoggedIn: jest.Mock };
  let passkeyStore: { hasPasskey: jest.Mock };

  const run = <T>(guard: (...args: never[]) => T, url = '/'): T =>
    TestBed.runInInjectionContext(() => (guard as unknown as (r: unknown, s: unknown) => T)({}, { url }));

  const resolve = async (result: unknown): Promise<unknown> => {
    const value = result instanceof Observable ? await firstValueFrom(result) : result;
    return value instanceof UrlTree ? value.toString() : value;
  };

  beforeEach(() => {
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
    mode = 'server';
    authService = { isInitialized$: jest.fn(() => of(true)), isLoggedIn: jest.fn().mockReturnValue(false) };
    passkeyStore = { hasPasskey: jest.fn().mockReturnValue(false) };

    TestBed.configureTestingModule({
      imports: [RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: PasskeyStoreService, useValue: passkeyStore },
        { provide: WalletDiscoveryService, useValue: { mode: () => mode } },
      ],
    });
  });

  describe('authGuard', () => {
    it('lets a signed-in user through', async () => {
      authService.isLoggedIn.mockReturnValue(true);

      expect(await resolve(run(authGuard, '/tabs/credentials'))).toBe(true);
    });

    it('sends a server-mode user without a session to the access screen and keeps the deep link', async () => {
      expect(await resolve(run(authGuard, '/tabs/vc-selector?x=1'))).toBe('/auth/access');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/tabs/vc-selector?x=1');
      expect(passkeyStore.hasPasskey).not.toHaveBeenCalled();
    });

    it('keeps the browser-mode login/register choice by the local passkey', async () => {
      mode = 'browser';
      passkeyStore.hasPasskey.mockReturnValue(true);

      expect(await resolve(run(authGuard, '/tabs/credentials'))).toBe('/auth/login');
    });
  });

  describe('accessRouteGuard', () => {
    it('shows the access screen without a session', async () => {
      expect(await resolve(run(accessRouteGuard))).toBe(true);
    });

    it('goes to the wallet when the session was resumed at start-up', async () => {
      authService.isLoggedIn.mockReturnValue(true);

      expect(await resolve(run(accessRouteGuard))).toBe('/tabs/credentials');
    });

    it('redirects browser mode to its own login screen', async () => {
      mode = 'browser';

      expect(await resolve(run(accessRouteGuard))).toBe('/auth/register');
    });
  });

  describe('browserModeAuthRouteGuard', () => {
    it('redirects /auth/login and /auth/register to the access screen in server mode', async () => {
      expect(await resolve(run(browserModeAuthRouteGuard))).toBe('/auth/access');
    });

    it('keeps them in browser mode', async () => {
      mode = 'browser';

      expect(await resolve(run(browserModeAuthRouteGuard))).toBe(true);
    });
  });
});
