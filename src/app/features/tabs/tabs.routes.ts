import { Routes } from '@angular/router';
import { authGuard } from '../../core/guards/auth.guard';
import { logsEnabledGuard } from '../../core/guards/logs-enabled.guard';

const routes: Routes = [
  {
    path: '',
    canActivateChild: [authGuard],
    loadComponent: () =>
      import('./tabs.page').then((m) => m.TabsPage),
    children: [
      {
        path: 'home',
        loadComponent: () =>
          import('../home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'credentials',
        loadComponent: () =>
          import('../credentials/credentials.page').then((m) => m.CredentialsPage),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('../settings/settings.page').then((m) => m.SettingsPage),
      },
      {
        path: 'language-selector',
        loadComponent: () =>
          import('../language-selector/language-selector.page').then(
            (m) => m.LanguageSelectorPage
          ),
      },
      {
        path: 'camera-selector',
        loadComponent: () =>
          import('../camera-selector/camera-selector.page').then(
            (m) => m.CameraSelectorPage
          ),
      },
      {
        path: 'activity',
        loadComponent: () =>
          import('../activity/activity.page').then((m) => m.ActivityPage),
      },
      {
        path: 'logs',
        canActivate: [logsEnabledGuard],
        loadComponent: () =>
          import('../logs/logs.page').then((m) => m.LogsPage),
        children: [
          {
            path: '',
            loadComponent: () =>
              import('../logs/logs/logs.component').then((m) => m.LogsComponent),
          },
          {
            path: 'camera',
            loadComponent: () =>
              import('../logs/camera-logs/camera-logs.page').then((m) => m.CameraLogsPage),
          },
          {
            path: '**',
            redirectTo: '/',
          }
        ],
      },
      {
        path: 'vc-selector',
        canActivate: [authGuard],
        loadComponent: () =>
          import('../vc-selector/vc-selector.page').then((m) => m.VcSelectorPage),
      },
      {
        path: '',
        redirectTo: 'home',
        pathMatch: 'full',
      },
      {
        path: '**',
        redirectTo: '/',
      }
    ],
  },
];

export default routes;
