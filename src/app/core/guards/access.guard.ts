import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { signInUrl, WALLET_HOME_ROUTE, whenAuthInitialized } from './auth.guard';

/**
 * `/auth/access` (EUD-8): server mode only. With a session already open (the
 * start-up resume succeeded) it goes straight to the wallet.
 */
export const accessRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (inject(WalletDiscoveryService).mode() !== 'server') {
    return router.parseUrl(signInUrl());
  }
  const authService = inject(AuthService);
  return whenAuthInitialized(authService, () =>
    authService.isLoggedIn() ? router.parseUrl(WALLET_HOME_ROUTE) : true
  );
};

/** `/auth/login` and `/auth/register` are browser mode screens; server mode has the single access screen. */
export const browserModeAuthRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(WalletDiscoveryService).mode() === 'server' ? router.parseUrl(signInUrl()) : true;
};
