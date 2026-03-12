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

  it('should navigate to HomePage for the default path', async () => {
    await router.navigate(['']);
    expect(location.path()).toBe('/home');
  });

  it('should navigate to CredentialsPage for /credentials', async () => {
    await router.navigate(['/credentials']);
    const module = await import('../credentials/credentials.page');
    expect(module.CredentialsPage).toBeTruthy();
    expect(location.path()).toBe('/credentials');
  });

  it('should navigate to SettingsPage for /settings', async () => {
    await router.navigate(['/settings']);
    const module = await import('../settings/settings.page');
    expect(module.SettingsPage).toBeTruthy();
    expect(location.path()).toBe('/settings');
  });

  it('should navigate to LogsPage for /logs', async () => {
    await router.navigate(['/logs']);
    const module = await import('../logs/logs.page');
    expect(module.LogsPage).toBeTruthy();
    expect(location.path()).toBe('/logs');
  });

  it('should navigate to LogsComponent for /logs', async () => {
    await router.navigate(['/logs']);
    const module = await import('../logs/logs/logs.component');
    expect(module.LogsComponent).toBeTruthy();
    expect(location.path()).toBe('/logs');
  });

  it('should navigate to CameraLogsPage for /logs/camera', async () => {
    await router.navigate(['/logs/camera']);
    const module = await import('../logs/camera-logs/camera-logs.page');
    expect(module.CameraLogsPage).toBeTruthy();
    expect(location.path()).toBe('/logs/camera');
  });

  it('should navigate to LanguageSelectorPage for /language-selector', async () => {
    await router.navigate(['/language-selector']);
    const module = await import('../language-selector/language-selector.page');
    expect(module.LanguageSelectorPage).toBeTruthy();
    expect(location.path()).toBe('/language-selector');
  });

  it('should redirect to / for unknown paths', async () => {
    await router.navigate(['tabs/unknown-path']);
    expect(location.path()).toBe('/home');
  });

  it('should apply authGuard on /', async () => {
    const authService = TestBed.inject(AuthService);
    await router.navigate(['/']);
    expect(authService.isInitialized$).toHaveBeenCalled();
  });

  it('should call authGuard when navigating between child routes', async () => {
    const authService = TestBed.inject(AuthService);

    await router.navigate(['/home']);
    const callsAfterHome = (authService.isInitialized$ as jest.Mock).mock.calls.length;

    await router.navigate(['/credentials']);
    expect((authService.isInitialized$ as jest.Mock).mock.calls.length).toBeGreaterThan(callsAfterHome);
  });

  it('should have logsEnabledGuard on /logs route', () => {
    const tabsRoute = originalRoutes[0];
    const logsRoute = tabsRoute.children?.find(r => r.path === 'logs');
    expect(logsRoute).toBeTruthy();
    expect(logsRoute!.canActivate).toBeTruthy();
    expect(logsRoute!.canActivate!.length).toBeGreaterThan(0);
  });
});