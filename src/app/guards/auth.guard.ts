import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { map, take } from 'rxjs/operators';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isLoggedIn$().pipe(
    take(1),
    map(isLoggedIn => {
      if (isLoggedIn) {
        return true;
      }
      const hasPasskey = localStorage.getItem('wallet_has_passkey') === 'true';
      router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
      return false;
    })
  );
};
