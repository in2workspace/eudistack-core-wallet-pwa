import { EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { Observable } from 'rxjs';
import { ACCESS_ROUTE, AuthService } from '../services/auth.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { filter, map, take } from 'rxjs/operators';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

/** Wallet home once signed in. */
export const WALLET_HOME_ROUTE = '/tabs/credentials';

/**
 * Where a user without a session goes. Server mode has a single access screen
 * (EUD-8); browser mode keeps its login/register choice by the local passkey.
 * Must run in an injection context.
 */
export function signInUrl(): string {
  if (inject(WalletDiscoveryService).mode() === 'server') {
    return ACCESS_ROUTE;
  }
  return inject(PasskeyStoreService).hasPasskey() ? '/auth/login' : '/auth/register';
}

/** Waits until the session state is known (server mode: the start-up resume has settled). */
export function whenAuthInitialized<T>(authService: AuthService, decide: () => T): Observable<T> {
  return authService.isInitialized$().pipe(
    filter(initialized => initialized),
    take(1),
    map(() => decide())
  );
}

export const authGuard: CanActivateFn = (_route, state: RouterStateSnapshot): Observable<boolean | UrlTree> => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const injector = inject(EnvironmentInjector);

  return whenAuthInitialized(authService, () => {
    if (authService.isLoggedIn()) {
      return true;
    }

    const targetUrl = state.url;
    if (targetUrl && targetUrl !== '/') {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, targetUrl);
    }
    return router.parseUrl(runInInjectionContext(injector, signInUrl));
  });
};
