import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { authLandingGuard, iosInstallGuard, iosInstallRouteGuard } from './core/guards/ios-install.guard';
import { hybridOnboardingGuard, hybridOnboardingRouteGuard } from './core/guards/hybrid-onboarding.guard';

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
    path: 'hybrid-onboarding',
    canActivate: [tenantGuard, authGuard, hybridOnboardingRouteGuard],
    loadComponent: () =>
      import('./features/hybrid-onboarding/hybrid-onboarding.page').then(
        m => m.HybridOnboardingPage
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
        path: 'login',
        loadComponent: () => import('./features/auth/login/login.page').then(m => m.LoginPage),
      },
      {
        path: 'register',
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
    canActivate: [tenantGuard, hybridOnboardingGuard],
    loadChildren: () => import('./features/tabs/tabs.routes').then(m => m.default),
  },
  {
    path: '**',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
];
