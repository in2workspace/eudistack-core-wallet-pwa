import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from './core/constants/deep-link.constants';
import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { PasskeyStoreService } from './core/services/passkey-store.service';

/**
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 * Saves the original URL (with query params) so it can be restored after auth.
 */
const authLandingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const passkeyStore = inject(PasskeyStoreService);
  const targetUrl = state.url;
  if (targetUrl && targetUrl !== '/' && !targetUrl.startsWith('/auth')) {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, targetUrl);
  }
  const hasPasskey = passkeyStore.hasPasskey();
  return router.createUrlTree([hasPasskey ? '/auth/login' : '/auth/register']);
};

export const routes: Routes = [
  {
    path: 'tenant-not-found',
    loadComponent: () => import('./features/tenant-not-found/tenant-not-found.page').then(m => m.TenantNotFoundPage),
  },
  {
    path: '',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
  {
    path: 'auth',
    canActivate: [tenantGuard],
    children: [
      {
        path: 'login',
        loadComponent: () => import('./features/auth/login/login.page').then(m => m.LoginPage),
      },
      {
        path: 'register',
        loadComponent: () => import('./features/auth/register/register.page').then(m => m.RegisterPage),
      },
    ]
  },
  {
    path: 'protocol/callback',
    canActivate: [tenantGuard, authGuard],
    loadComponent: () =>
      import('./features/protocol-callback/protocol-callback.page').then(
        m => m.ProtocolCallbackPage
      ),
  },
  {
    path: 'tabs',
    canActivate: [tenantGuard],
    loadChildren: () => import('./features/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
];
