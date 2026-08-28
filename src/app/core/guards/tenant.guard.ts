import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { TenantService } from '../services/tenant.service';

export const tenantGuard: CanActivateFn = () => {
  const router = inject(Router);

  if (inject(TenantService).tenant() !== null) {
    return true;
  }

  return router.createUrlTree(['/tenant-not-found']);
};
