import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { filter, map, take } from 'rxjs/operators';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const passkeyStore = inject(PasskeyStoreService);
  const router = inject(Router);

  return authService.isInitialized$().pipe(
    filter(initialized => initialized),
    take(1),
    map(() => {
      if (authService.isLoggedIn()) {
        return true;
      }

      const currentUrl = window.location.pathname + window.location.search;
      if (currentUrl && currentUrl !== '/') {
        sessionStorage.setItem(PENDING_DEEP_LINK_KEY, currentUrl);
      }

      const hasPasskey = passkeyStore.hasPasskey();
      router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      return false;
    })
  );
};
