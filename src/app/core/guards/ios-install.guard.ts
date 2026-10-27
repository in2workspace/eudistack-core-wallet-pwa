import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { ACCESS_ROUTE, AuthService } from '../services/auth.service';
import { WALLET_HOME_ROUTE, whenAuthInitialized } from './auth.guard';

/**
 * Redirects iOS Safari browser-mode users to the install onboarding wizard
 * before they can access the auth flow (AC-008.1, AC-008.2, AC-008.6).
 *
 * Passes through when:
 *  - Wallet runs in server mode (credentials live in the backend)
 *  - Not iOS Safari (Android, Desktop, macOS Safari, CriOS/FxiOS) → AC-008.6
 *  - Running as installed PWA (standalone) → AC-008.5
 *  - User has already dismissed the wizard this session → AC-008.7
 */
export const iosInstallGuard: CanActivateFn = () => {
  const router = inject(Router);
  const iosInstall = inject(IosInstallService);
  const passkeyStore = inject(PasskeyStoreService);

  if (iosInstall.shouldShowInstallWizard()) {
    const state = iosInstall.wizardState(passkeyStore.hasPasskey());
    return router.createUrlTree(['/ios-install'], { queryParams: { state } });
  }

  return true;
};

/**
 * Landing (`/` and unknown paths). Server mode: once the start-up resume has
 * settled, the wallet if a session is open, the access screen otherwise.
 * Browser mode: /auth/login if a passkey was registered on this device,
 * otherwise /auth/register, with the iOS Safari install wizard first (AC-008.1–2).
 * Saves the original URL (with query params) so it can be restored after auth.
 */
export const authLandingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const passkeyStore = inject(PasskeyStoreService);
  const iosInstall = inject(IosInstallService);
  const targetUrl = state.url;

  if (iosInstall.isServerMode()) {
    const authService = inject(AuthService);
    return whenAuthInitialized(authService, () => {
      if (authService.isLoggedIn()) {
        return router.parseUrl(WALLET_HOME_ROUTE);
      }
      savePendingDeepLink(targetUrl);
      return router.parseUrl(ACCESS_ROUTE);
    });
  }

  savePendingDeepLink(targetUrl);
  const hasPasskey = passkeyStore.hasPasskey();
  if (iosInstall.shouldShowInstallWizard()) {
    const wizardState = iosInstall.wizardState(hasPasskey);
    return router.createUrlTree(['/ios-install'], { queryParams: { state: wizardState } });
  }
  return router.createUrlTree([hasPasskey ? '/auth/login' : '/auth/register']);
};

function savePendingDeepLink(targetUrl: string): void {
  if (targetUrl && targetUrl !== '/' && !targetUrl.startsWith('/auth')) {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, targetUrl);
  }
}

/**
 * Inverse guard: prevents direct navigation to `/ios-install` from non-iOS
 * browsers, standalone mode or server mode. Redirects to `/`.
 */
export const iosInstallRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  const iosInstall = inject(IosInstallService);

  if (!iosInstall.isIosSafariBrowserMode() || iosInstall.isServerMode()) {
    return router.createUrlTree(['/']);
  }

  return true;
};
