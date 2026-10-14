import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { authLandingGuard, iosInstallGuard, iosInstallRouteGuard } from './core/guards/ios-install.guard';
import { accessRouteGuard, browserModeAuthRouteGuard } from './core/guards/access.guard';
import { passkeyPrfOnboardingGuard, passkeyPrfOnboardingRouteGuard } from './core/guards/passkey-prf-onboarding.guard';

export const routes: Routes = [
  {
    path: 'tenant-not-found',
    loadComponent: () => import('./features/tenant-not-found/tenant-not-found.page').then(m => m.TenantNotFoundPage),
  },
  {
    path: 'ios-install',
    canActivate: [tenantGuard, iosInstallRouteGuard],
    loadComponent: () =>
      import('./features/ios-install-onboarding/ios-install-onboarding.page').then(
        m => m.IosInstallOnboardingPage
      ),
  },
  {
    path: 'passkey-prf-onboarding',
    canActivate: [tenantGuard, authGuard, passkeyPrfOnboardingRouteGuard],
    loadComponent: () =>
      import('./features/passkey-prf-onboarding/passkey-prf-onboarding.page').then(
        m => m.PasskeyPrfOnboardingPage
      ),
  },
  {
    path: '',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
  {
    path: 'auth',
    canActivate: [tenantGuard, iosInstallGuard],
    children: [
      {
        // Server mode (EUD-8): single access screen for sign-in and the email flow.
        path: 'access',
        canActivate: [accessRouteGuard],
        loadComponent: () => import('./features/auth/access/access.page').then(m => m.AccessPage),
      },
      {
        path: 'login',
        canActivate: [browserModeAuthRouteGuard],
        loadComponent: () => import('./features/auth/login/login.page').then(m => m.LoginPage),
      },
      {
        path: 'register',
        canActivate: [browserModeAuthRouteGuard],
        loadComponent: () => import('./features/auth/login/login.page').then(m => m.LoginPage),
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
    canActivate: [tenantGuard, passkeyPrfOnboardingGuard],
    loadChildren: () => import('./features/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
];
