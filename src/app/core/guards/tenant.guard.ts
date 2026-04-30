import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { isKnownTenant } from '../constants/tenants.constants';

export const tenantGuard: CanActivateFn = () => {
  const router = inject(Router);

  if (isKnownTenant(window.location.hostname)) {
    return true;
  }

  return router.createUrlTree(['/tenant-not-found']);
};
