import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PasskeyPrfService } from '../services/passkey-prf.service';
import { PasskeyStoreService } from '../services/passkey-store.service';
import { filter, switchMap, take } from 'rxjs/operators';
import { from } from 'rxjs';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const prfService = inject(PasskeyPrfService);
  const passkeyStore = inject(PasskeyStoreService);
  const router = inject(Router);

  return authService.isInitialized$().pipe(
    filter(initialized => initialized),
    take(1),
    switchMap(() => authService.isLoggedIn$().pipe(take(1))),
    switchMap(isLoggedIn => {
      if (isLoggedIn) {
        return from(Promise.resolve(true));
      }

      const currentUrl = window.location.pathname + window.location.search;
      if (currentUrl && currentUrl !== '/') {
        sessionStorage.setItem(PENDING_DEEP_LINK_KEY, currentUrl);
      }

      const hasPasskey = passkeyStore.hasPasskey();
      if (hasPasskey) {
        router.navigate(['/auth/login']);
        return from(Promise.resolve(false));
      }

      // Attempt to recover a discoverable passkey before sending to register
      return from(prfService.tryRecoverPasskey().then(recovered => {
        router.navigate([recovered ? '/auth/login' : '/auth/register']);
        return false;
      }));
    })
  );
};
