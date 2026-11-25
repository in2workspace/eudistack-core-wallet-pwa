import { inject } from '@angular/core';
import { CanActivateFn, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { REGISTER_DEVICE_ROUTE, RemoteAuthService } from '../services/auth.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { WALLET_HOME_ROUTE, signInUrl } from './auth.guard';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';

/**
 * Wallet screens need a session bound to an active device (EUD-15 FR-06, design §2.2). Without one, the user goes
 * to "Registrar este dispositivo" first; the screen they were going to, such as a credential offer or a
 * presentation request, is kept and opened once the device is registered. Server mode only: the browser mode has
 * no devices. A user without a session is left to `authGuard`.
 */
export const deviceRegistrationGuard: CanActivateFn = async (_route, state: RouterStateSnapshot) => {
  if (inject(WalletDiscoveryService).mode() !== 'server') {
    return true;
  }
  const auth = inject(RemoteAuthService);
  const router = inject(Router);
  await whenInitialized(auth);
  if (!auth.isLoggedIn()) {
    return true;
  }
  const device = await auth.deviceReady();
  if (device === 'bound') {
    return true;
  }
  if (device === 'unavailable') {
    // Temporary failure, retried in the background (design §2.2): the wallet is shown, but an offer or a
    // presentation request waits until the session is bound, and then resumes.
    if (!state?.url || !startsAttestationFlow(state.url)) {
      return true;
    }
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, state.url);
    return router.parseUrl(WALLET_HOME_ROUTE);
  }
  if (state?.url && state.url !== '/') {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, state.url);
  }
  return router.parseUrl(REGISTER_DEVICE_ROUTE);
};

/** Routes that obtain or present an attestation: scanning, the protocol callback and offer or request links. */
export function startsAttestationFlow(url: string): boolean {
  return url.startsWith('/tabs/scan')
    || url.startsWith('/protocol/callback')
    || /[?&](credential_offer|credential_offer_uri|request|request_uri)=/.test(url);
}

/**
 * `/registrar-dispositivo`: only with an open session whose Wallet App has no active device. Without a session it
 * goes to the access screen; with a device already bound, on to where the user was going.
 */
export const registerDeviceRouteGuard: CanActivateFn = async (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  // Resolved now: inject() is not available after the first await.
  const signIn = router.parseUrl(signInUrl());
  if (inject(WalletDiscoveryService).mode() !== 'server') {
    return signIn;
  }
  const auth = inject(RemoteAuthService);
  await whenInitialized(auth);
  if (!auth.isLoggedIn()) {
    return signIn;
  }
  if ((await auth.deviceReady()) === 'unregistered') {
    return true;
  }
  return router.parseUrl(takePendingDeepLink() || WALLET_HOME_ROUTE);
};

function whenInitialized(auth: RemoteAuthService): Promise<boolean> {
  return firstValueFrom(auth.isInitialized$().pipe(filter(initialized => initialized), take(1)));
}
