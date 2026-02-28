import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 */
const authLandingGuard = () => {
  const router = inject(Router);
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
    path: 'tabs',
    loadChildren: () => import('./pages/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [authLandingGuard],
    children: [],
  },
];
