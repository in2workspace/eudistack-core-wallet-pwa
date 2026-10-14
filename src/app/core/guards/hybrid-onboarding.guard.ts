import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { HybridOnboardingService } from '../services/hybrid-onboarding.service';


export const hybridOnboardingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);
  const hybridOnboarding = inject(HybridOnboardingService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager === 'hybrid' && !hybridOnboarding.isAccepted()) {
    // The acceptance lives in sessionStorage, so every cold start lands here: keep the
    // original target (e.g. an incoming credential offer) to resume it once accepted.
    if (state?.url && state.url !== '/') {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, state.url);
    }
    return router.createUrlTree(['/hybrid-onboarding']);
  }
  return true;
};

export const hybridOnboardingRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager !== 'hybrid') {
    return router.createUrlTree(['/']);
  }
  return true;
};
