import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router, Routes } from '@angular/router';
import { Location } from '@angular/common';
import originalRoutes from './tabs.routes';
import { AuthService } from '../../core/services/auth.service';
import { PasskeyStoreService } from '../../core/services/passkey-store.service';
import { of } from 'rxjs';

// Deep-clone routes and remove logsEnabledGuard (it reads environment directly, not injectable)
function cloneRoutesWithoutLogsGuard(routes: Routes): Routes {
  return routes.map(route => {
    const clone = { ...route };
    if (clone.children) {
      clone.children = clone.children.map(child => {
        if (child.path === 'logs') {
          return { ...child, canActivate: [] };
        }
        return { ...child };
      });
    }
    return clone;
  });
}

const routes = cloneRoutesWithoutLogsGuard(originalRoutes);

describe('App Routes', () => {
  let router: Router;
  let location: Location;

  beforeEach(async () => {
    const mockAuthService = {
      isLoggedIn$: jest.fn().mockReturnValue(of(true)),
      isInitialized$: jest.fn().mockReturnValue(of(true)),
      isLoggedIn: jest.fn().mockReturnValue(true),
    };

    const mockPasskeyStore = {
      hasPasskey: jest.fn().mockReturnValue(false),
    };

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes(routes)],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        { provide: PasskeyStoreService, useValue: mockPasskeyStore },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    location = TestBed.inject(Location);

    router.initialNavigation();
  });

  it('should navigate to CredentialsPage for the default path', async () => {
    await router.navigate(['']);
    expect(location.path()).toBe('/credentials');
  });

  it('should navigate to CredentialsPage for /credentials', async () => {
    await router.navigate(['/credentials']);
    const module = await import('../credentials/credentials.page');
    expect(module.CredentialsPage).toBeTruthy();
    expect(location.path()).toBe('/credentials');
  });

  it('should redirect to / for unknown paths', async () => {
    await router.navigate(['tabs/unknown-path']);
    expect(location.path()).toBe('/credentials');
  });

  it('should apply authGuard on /', async () => {
    const authService = TestBed.inject(AuthService);
    await router.navigate(['/']);
    expect(authService.isInitialized$).toHaveBeenCalled();
  });

  it('should call authGuard when navigating between child routes', async () => {
    const authService = TestBed.inject(AuthService);

    await router.navigate(['/scan']);
    const callsAfterScan = (authService.isInitialized$ as jest.Mock).mock.calls.length;

    await router.navigate(['/credentials']);
    expect((authService.isInitialized$ as jest.Mock).mock.calls.length).toBeGreaterThan(callsAfterScan);
  });

  it('should have logsEnabledGuard on /logs route', () => {
    const tabsRoute = originalRoutes[0];
    const logsRoute = tabsRoute.children?.find(r => r.path === 'logs');
    expect(logsRoute).toBeTruthy();
    expect(logsRoute!.canActivate).toBeTruthy();
    expect(logsRoute!.canActivate!.length).toBeGreaterThan(0);
  });
});