import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from './core/constants/deep-link.constants';
import { authGuard } from './core/guards/auth.guard';
import { PasskeyStoreService } from './core/services/passkey-store.service';

/**
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 * Saves the original URL (with query params) so it can be restored after auth.
 */
const authLandingGuard = () => {
  const router = inject(Router);
  const passkeyStore = inject(PasskeyStoreService);
  const currentUrl = window.location.pathname + window.location.search;
  if (currentUrl && currentUrl !== '/') {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, currentUrl);
  }
  const hasPasskey = passkeyStore.hasPasskey();
  return router.createUrlTree([hasPasskey ? '/auth/login' : '/auth/register']);
};

export const routes: Routes = [
  {
    path: '',
    canActivate: [authLandingGuard],
    children: [],
  },
  {
    path: 'auth',
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
    path: 'callback',
    loadComponent: () =>
      import('./features/oid4vci-callback/oid4vci-callback.page').then(
        m => m.Oid4vciCallbackPage
      ),
  },
  {
    path: 'protocol/callback',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/protocol-callback/protocol-callback.page').then(
        m => m.ProtocolCallbackPage
      ),
  },
  {
    path: 'tabs',
    loadChildren: () => import('./features/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [authLandingGuard],
    children: [],
  },
];
