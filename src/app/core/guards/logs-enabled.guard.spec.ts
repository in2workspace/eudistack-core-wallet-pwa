import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { logsEnabledGuard } from './logs-enabled.guard';
import { environment } from 'src/environments/environment';

describe('logsEnabledGuard', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])]
    });

    router = TestBed.inject(Router);
  });

  afterEach(() => {
    jest.clearAllMocks(); 
  });

  it('should allow activation if logs are enabled', () => {
    environment.logs_enabled = true; 

    const result = TestBed.runInInjectionContext(() => logsEnabledGuard(null as any, null as any));

    expect(result).toBe(true);
  });

  it('should block activation and redirect to /settings if logs are disabled', () => {
    environment.logs_enabled = false; 

    const result = TestBed.runInInjectionContext(() => logsEnabledGuard(null as any, null as any));

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/settings');
  });
});
