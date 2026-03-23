import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { routes } from './app.routes';
import { HttpClientModule } from '@angular/common/http';
import { logsEnabledGuard } from './core/guards/logs-enabled.guard';
import { authGuard } from './core/guards/auth.guard';
import { PasskeyStoreService } from './core/services/passkey-store.service';
import { PENDING_DEEP_LINK_KEY } from './core/constants/deep-link.constants';
import { of } from 'rxjs';

describe('App Routing', () => {
  let router: Router;

  const mockLogsEnabledGuard = jest.fn().mockReturnValue(true);
  const mockAuthGuard = jest.fn().mockReturnValue(of(true));
  const mockPasskeyStore = { hasPasskey: jest.fn().mockReturnValue(true), getCredentialId: jest.fn() };

  beforeEach(async () => {
    mockPasskeyStore.hasPasskey.mockReturnValue(true);
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes(routes), HttpClientModule],
      providers: [
        { provide: authGuard, useValue: mockAuthGuard },
        { provide: logsEnabledGuard, useValue: mockLogsEnabledGuard },
        { provide: PasskeyStoreService, useValue: mockPasskeyStore },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
  });

  afterEach(() => {
    sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
  });

  it('should redirect an empty path to /auth/login', async () => {
    await router.navigate(['']);
    expect(router.url).toBe('/auth/login');
  });

  it('should lazy load tabs module for /tabs/home', async () => {
    await router.navigate(['/tabs']);
    expect(router.url).toBe('/tabs/home');
  });

  it('should load login page for /auth/login', async () => {
    await router.navigate(['/auth/login']);
    expect(router.url).toBe('/auth/login');
  });

  it('should redirect unknown routes to /auth/login', async () => {
    await router.navigate(['/unknown-route']);
    expect(router.url).toBe('/auth/login');
  });

  it('should redirect to /auth/register when hasPasskey returns false', async () => {
    mockPasskeyStore.hasPasskey.mockReturnValue(false);
    await router.navigate(['']);
    expect(router.url).toBe('/auth/register');
  });

  it('should redirect unknown routes to /auth/register when hasPasskey returns false', async () => {
    mockPasskeyStore.hasPasskey.mockReturnValue(false);
    await router.navigate(['/some/unknown']);
    expect(router.url).toBe('/auth/register');
  });

  it('should save deep link to sessionStorage when pathname is not /', async () => {
    // The guard reads window.location directly. In jsdom we must override
    // the property before the guard executes.
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, pathname: '/protocol/callback', search: '?code=abc' },
      writable: true,
      configurable: true,
    });

    await router.navigate(['']);
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/protocol/callback?code=abc');

    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('should NOT save deep link to sessionStorage when pathname is /', async () => {
    // Default jsdom pathname is "/" so no override needed
    await router.navigate(['']);
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  describe('route definitions', () => {
    it('should define auth/login route with lazy-loaded LoginPage', () => {
      const authRoute = routes.find(r => r.path === 'auth');
      expect(authRoute).toBeDefined();
      const loginRoute = authRoute!.children!.find((r: any) => r.path === 'login');
      expect(loginRoute).toBeDefined();
      expect(loginRoute!.loadComponent).toBeDefined();
    });

    it('should define auth/register route with lazy-loaded RegisterPage', () => {
      const authRoute = routes.find(r => r.path === 'auth');
      const registerRoute = authRoute!.children!.find((r: any) => r.path === 'register');
      expect(registerRoute).toBeDefined();
      expect(registerRoute!.loadComponent).toBeDefined();
    });

    it('should define protocol/callback route with authGuard', () => {
      const callbackRoute = routes.find(r => r.path === 'protocol/callback');
      expect(callbackRoute).toBeDefined();
      expect(callbackRoute!.canActivate).toContain(authGuard);
      expect(callbackRoute!.loadComponent).toBeDefined();
    });

    it('should resolve protocol/callback loadComponent without error', async () => {
      const callbackRoute = routes.find(r => r.path === 'protocol/callback');
      const mod = await callbackRoute!.loadComponent!() as any;
      // The dynamic import resolves to a module or component; verify it is truthy
      expect(mod).toBeTruthy();
    });

    it('should define tabs route with lazy-loaded children', () => {
      const tabsRoute = routes.find(r => r.path === 'tabs');
      expect(tabsRoute).toBeDefined();
      expect(tabsRoute!.loadChildren).toBeDefined();
    });

    it('should define wildcard route as catch-all', () => {
      const wildcardRoute = routes.find(r => r.path === '**');
      expect(wildcardRoute).toBeDefined();
    });
  });
});
