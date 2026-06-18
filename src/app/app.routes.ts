import { Routes } from '@angular/router';
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from './core/constants/deep-link.constants';
import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { iosInstallGuard, iosInstallRouteGuard } from './core/guards/ios-install.guard';
import { PasskeyStoreService } from './core/services/passkey-store.service';
import { IosInstallService } from './shared/services/ios-install.service';

/**
 * Redirects to /auth/login if a passkey was previously registered on this
 * device, otherwise to /auth/register.
 * Saves the original URL (with query params) so it can be restored after auth.
 * Intercepts iOS Safari browser-mode users and redirects to /ios-install (AC-008.1–2).
 */
const authLandingGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  const passkeyStore = inject(PasskeyStoreService);
  const iosInstall = inject(IosInstallService);
  const targetUrl = state.url;
  if (targetUrl && targetUrl !== '/' && !targetUrl.startsWith('/auth')) {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, targetUrl);
  }
  const hasPasskey = passkeyStore.hasPasskey();
  if (iosInstall.isIosSafariBrowserMode() && !iosInstall.isDismissed()) {
    const wizardState = iosInstall.wizardState(hasPasskey);
    return router.createUrlTree(['/ios-install'], { queryParams: { state: wizardState } });
  }
  return router.createUrlTree([hasPasskey ? '/auth/login' : '/auth/register']);
};

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
    path: 'wallet/callback',
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
