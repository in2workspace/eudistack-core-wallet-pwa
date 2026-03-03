import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { filter, map, switchMap, take } from 'rxjs/operators';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isInitialized$().pipe(
    filter(initialized => initialized),
    take(1),
    switchMap(() => authService.isLoggedIn$().pipe(take(1))),
    map(isLoggedIn => {
      if (isLoggedIn) {
        return true;
      }
      const currentUrl = window.location.pathname + window.location.search;
      if (currentUrl && currentUrl !== '/') {
        sessionStorage.setItem(PENDING_DEEP_LINK_KEY, currentUrl);
      }
      const hasPasskey = localStorage.getItem('wallet_has_passkey') === 'true';
      router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      return false;
    })
  );
};
