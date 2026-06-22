import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { HybridOnboardingService } from '../services/hybrid-onboarding.service';

/**
 * Redirects authenticated users to /hybrid-onboarding when key_manager=hybrid
 * and they have not yet accepted the multi-device constraint (US-06, EUDISTACK-538).
 *
 * Applied to the 'tabs' route so the user is already authenticated when the
 * onboarding screen is shown and the audit event HTTP call can attach actor_id.
 */
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

/**
 * Inverse guard: prevents direct navigation to /hybrid-onboarding when the
 * tenant is not configured for hybrid key management.
 */
export const hybridOnboardingRouteGuard: CanActivateFn = () => {
  const router = inject(Router);
  const discovery = inject(WalletDiscoveryService);

  const snap = discovery.snapshot()();
  if (snap?.keyManager !== 'hybrid') {
    return router.createUrlTree(['/']);
  }
  return true;
};
