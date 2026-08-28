import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PasskeyStoreService } from '../services/passkey-store.service';

/**
 * Redirects iOS Safari browser-mode users to the install onboarding wizard
 * before they can access the auth flow (AC-008.1, AC-008.2, AC-008.6).
 *
 * Passes through when:
 *  - Not iOS Safari (Android, Desktop, macOS Safari, CriOS/FxiOS) → AC-008.6
 *  - Running as installed PWA (standalone) → AC-008.5
 *  - User has already dismissed the wizard this session → AC-008.7
 */
export const iosInstallGuard: CanActivateFn = () => {
  const router = inject(Router);
  const iosInstall = inject(IosInstallService);
  const passkeyStore = inject(PasskeyStoreService);

  if (iosInstall.isIosSafariBrowserMode() && !iosInstall.isDismissed()) {
    const state = iosInstall.wizardState(passkeyStore.hasPasskey());
    return router.createUrlTree(['/ios-install'], { queryParams: { state } });
  }

  return true;
};

/**
 * Inverse guard: prevents direct navigation to `/ios-install` from non-iOS
 * browsers or from standalone mode. Redirects to `/`.
 */
export const iosInstallRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  const iosInstall = inject(IosInstallService);

  if (!iosInstall.isIosSafariBrowserMode()) {
    return router.createUrlTree(['/']);
  }

  return true;
};
