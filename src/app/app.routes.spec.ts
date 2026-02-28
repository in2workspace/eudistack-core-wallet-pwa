import { TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { Router } from '@angular/router';
import { routes } from './app.routes';
import { HttpClientModule } from '@angular/common/http';
import { logsEnabledGuard } from './guards/logs-enabled.guard';
import { authGuard } from './guards/auth.guard';
import { of } from 'rxjs';

describe('App Routing', () => {
  let router: Router;

  const mockLogsEnabledGuard = jest.fn().mockReturnValue(true);
  const mockAuthGuard = jest.fn().mockReturnValue(of(true));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule.withRoutes(routes), HttpClientModule],
      providers: [
        { provide: authGuard, useValue: mockAuthGuard },
        { provide: logsEnabledGuard, useValue: mockLogsEnabledGuard },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
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
});
