import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { PasskeyStoreService } from '../services/passkey-store.service';

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
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 * Saves the original URL (with query params) so it can be restored after auth.
 * Intercepts iOS Safari browser-mode users and redirects to /ios-install (AC-008.1–2).
 */
export const authLandingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const passkeyStore = inject(PasskeyStoreService);
  const iosInstall = inject(IosInstallService);
  const targetUrl = state.url;
  if (targetUrl && targetUrl !== '/' && !targetUrl.startsWith('/auth')) {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, targetUrl);
  }
  const hasPasskey = passkeyStore.hasPasskey();
  if (iosInstall.shouldShowInstallWizard()) {
    const wizardState = iosInstall.wizardState(hasPasskey);
    return router.createUrlTree(['/ios-install'], { queryParams: { state: wizardState } });
  }
  return router.createUrlTree([hasPasskey ? '/auth/login' : '/auth/register']);
};

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
