import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { PasskeyPrfOnboardingService } from '../services/passkey-prf-onboarding.service';


export const passkeyPrfOnboardingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);
  const passkeyPrfOnboarding = inject(PasskeyPrfOnboardingService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager === 'passkey-prf' && !passkeyPrfOnboarding.isAccepted()) {
    // The acceptance lives in sessionStorage, so every cold start lands here: keep the
    // original target (e.g. an incoming credential offer) to resume it once accepted.
    if (state?.url && state.url !== '/') {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, state.url);
    }
    return router.createUrlTree(['/passkey-prf-onboarding']);
  }
  return true;
};

export const passkeyPrfOnboardingRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager !== 'passkey-prf') {
    return router.createUrlTree(['/']);
  }
  return true;
};
