import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from './constants/deep-link.constants';
import { authGuard } from './guards/auth.guard';

/**
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 * Saves the original URL (with query params) so it can be restored after auth.
 */
const authLandingGuard = () => {
  const router = inject(Router);
  const currentUrl = window.location.pathname + window.location.search;
  if (currentUrl && currentUrl !== '/') {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, currentUrl);
  }
  const hasPasskey = localStorage.getItem('wallet_has_passkey') === 'true';
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
        loadComponent: () => import('./pages/auth/login/login.page').then(m => m.LoginPage),
      },
      {
        path: 'register',
        loadComponent: () => import('./pages/auth/register/register.page').then(m => m.RegisterPage),
      },
      {
        path: 'passkey-setup',
        loadComponent: () => import('./pages/auth/passkey-setup/passkey-setup.page').then(m => m.PasskeySetupPage),
      },
    ]
  },
  {
    path: 'protocol/callback',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/protocol-callback/protocol-callback.page').then(
        m => m.ProtocolCallbackPage
      ),
  },
  {
    path: 'tabs',
    loadChildren: () => import('./pages/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [authLandingGuard],
    children: [],
  },
];
