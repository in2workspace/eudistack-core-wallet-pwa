import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router, Routes } from '@angular/router';
import { Location } from '@angular/common';
import routes from './about.routes';

describe('About Routes', () => {
  let router: Router;
  let location: Location;

  beforeEach(async () => {
    // Mounted at the same absolute prefix tabs.routes.ts registers it under, so the
    // guard's `router.createUrlTree(['/tabs/about'])` redirect (ES-02) resolves correctly.
    const wrapped: Routes = [{ path: 'tabs/about', children: routes }];

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes(wrapped)],
    }).compileComponents();

    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    router.initialNavigation();
  });

  it('resolves the default path to AboutPage (AC-01)', async () => {
    await router.navigate(['/tabs/about']);
    const module = await import('./about.page');
    expect(module.AboutPage).toBeTruthy();
    expect(location.path()).toBe('/tabs/about');
  });

  it('resolves legal/:docId to LegalDocumentPage for a catalogued id (AC-03)', async () => {
    await router.navigate(['/tabs/about/legal/privacy-policy']);
    const module = await import('./legal-document/legal-document.page');
    expect(module.LegalDocumentPage).toBeTruthy();
    expect(location.path()).toBe('/tabs/about/legal/privacy-policy');
  });

  it('resolves licenses to OssLicensesPage (AC-05)', async () => {
    await router.navigate(['/tabs/about/licenses']);
    const module = await import('./oss-licenses/oss-licenses.page');
    expect(module.OssLicensesPage).toBeTruthy();
    expect(location.path()).toBe('/tabs/about/licenses');
  });

  it('redirects to About for a docId outside the closed catalogue (ES-02)', async () => {
    await router.navigate(['/tabs/about/legal', 'unknown-doc']);
    expect(location.path()).toBe('/tabs/about');
  });

  it('redirects to About for a completely unknown sub-path', async () => {
    await router.navigate(['/tabs/about/unknown']);
    expect(location.path()).toBe('/tabs/about');
  });
});
