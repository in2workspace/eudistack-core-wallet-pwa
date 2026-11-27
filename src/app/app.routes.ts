import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { tenantGuard } from './core/guards/tenant.guard';
import { authLandingGuard, iosInstallGuard, iosInstallRouteGuard } from './core/guards/ios-install.guard';
import { accessRouteGuard, browserModeAuthRouteGuard } from './core/guards/access.guard';
import { passkeyPrfOnboardingGuard, passkeyPrfOnboardingRouteGuard } from './core/guards/passkey-prf-onboarding.guard';
import { deviceRegistrationGuard, registerDeviceRouteGuard } from './core/guards/device.guard';

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
    canActivate: [tenantGuard, authGuard, deviceRegistrationGuard, passkeyPrfOnboardingRouteGuard],
    loadComponent: () =>
      import('./features/passkey-prf-onboarding/passkey-prf-onboarding.page').then(
        m => m.PasskeyPrfOnboardingPage
      ),
  },
  {
    // EUD-15: "Registrar este dispositivo", its own step after the passkey and before the wallet.
    path: 'registrar-dispositivo',
    canActivate: [tenantGuard, registerDeviceRouteGuard],
    loadComponent: () =>
      import('./features/register-device/register-device.page').then(m => m.RegisterDevicePage),
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
    canActivate: [tenantGuard, authGuard, deviceRegistrationGuard],
    loadComponent: () =>
      import('./features/protocol-callback/protocol-callback.page').then(
        m => m.ProtocolCallbackPage
      ),
  },
  {
    path: 'tabs',
    // The device first (EUD-15 FR-06): nothing of the wallet runs on a session without one.
    canActivate: [tenantGuard, deviceRegistrationGuard, passkeyPrfOnboardingGuard],
    loadChildren: () => import('./features/tabs/tabs.routes').then(m => m.default),
  },
  {
    // EUD-315: onboarding address /t#<ticket>. Public: it decides itself between the
    // access screen and the wallet once the ticket is redeemed. The ticket is in the
    // fragment, which never reaches the server (P18).
    path: 't',
    canActivate: [tenantGuard],
    loadComponent: () =>
      import('./features/onboarding-ticket/onboarding-ticket.page').then(m => m.OnboardingTicketPage),
  },
  {
    // EUD-315: "it was not me" link of the new-account email, /not-me#<token>.
    // Public, never opens a session. The token is in the fragment (P18).
    path: 'not-me',
    canActivate: [tenantGuard],
    loadComponent: () => import('./features/not-me/not-me.page').then(m => m.NotMePage),
  },
  {
    path: '**',
    canActivate: [tenantGuard, authLandingGuard],
    children: [],
  },
];
