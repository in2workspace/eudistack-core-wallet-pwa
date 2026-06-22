import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { HybridOnboardingService } from '../services/hybrid-onboarding.service';


export const hybridOnboardingGuard: CanActivateFn = () => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);
  const hybridOnboarding = inject(HybridOnboardingService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager === 'hybrid' && !hybridOnboarding.isAccepted()) {
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
