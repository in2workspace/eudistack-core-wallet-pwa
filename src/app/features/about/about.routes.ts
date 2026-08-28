import { Routes } from '@angular/router';
import { legalDocumentGuard } from './guards/legal-document.guard';

const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./about.page').then((m) => m.AboutPage),
  },
  {
    path: 'legal/:docId',
    canActivate: [legalDocumentGuard], // ES-02: validates BEFORE the page is instantiated
    loadComponent: () => import('./legal-document/legal-document.page').then((m) => m.LegalDocumentPage),
  },
  {
    path: 'licenses',
    loadComponent: () => import('./oss-licenses/oss-licenses.page').then((m) => m.OssLicensesPage),
  },
  // Do NOT copy the `{ path: '**', redirectTo: '/' }` used by `logs`: '/' triggers the
  // auth-landing guard and expels the user from the tabs area. Redirect within About instead.
  { path: '**', redirectTo: '', pathMatch: 'full' },
];

export default routes;
