import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { LocalAuthService } from './local-auth.service';
import { PasskeyPrfService } from './passkey-prf.service';

describe('LocalAuthService', () => {
  let service: LocalAuthService;
  let prfServiceSpy: jest.Mocked<PasskeyPrfService>;
  let routerSpy: jest.Mocked<Router>;

  beforeEach(() => {
    prfServiceSpy = {
      hasPasskey: jest.fn(),
      createPasskey: jest.fn()
    } as any;

    routerSpy = {
      navigate: jest.fn()
    } as any;

    TestBed.configureTestingModule({
      providers: [
        LocalAuthService,
        { provide: PasskeyPrfService, useValue: prfServiceSpy },
        { provide: Router, useValue: routerSpy }
      ]
    });

    service = TestBed.inject(LocalAuthService);
  });

  it('should be created and initialized', (done) => {
    expect(service).toBeTruthy();
    service.isInitialized$().subscribe(val => {
      expect(val).toBe(true);
      done();
    });
  });

  it('isLoggedIn() should return false initially', () => {
    expect(service.isLoggedIn()).toBe(false);
  });

  it('getToken() should return empty string', () => {
    expect(service.getToken()).toBe('');
  });

  it('refreshAccessToken() errors and does not change getToken()', (done) => {
    service.refreshAccessToken().subscribe({
      error: () => {
        expect(service.getToken()).toBe('');
        done();
      }
    });
  });

  it('getName$() should emit empty string initially', (done) => {
    service.getName$().subscribe(name => {
      expect(name).toBe('');
      done();
    });
  });

  it('hasPasskey() should delegate to prfService', () => {
    prfServiceSpy.hasPasskey.mockReturnValue(true);
    expect(service.hasPasskey()).toBe(true);
    expect(prfServiceSpy.hasPasskey).toHaveBeenCalled();
  });

  describe('setupPasskey', () => {
    it('should create passkey and update state', async () => {
      await service.setupPasskey('Test User');
      expect(prfServiceSpy.createPasskey).toHaveBeenCalledWith('Test User');
      expect(service.isLoggedIn()).toBe(true);

      service.getName$().subscribe(name => {
        expect(name).toBe('Test User');
      });
    });

    it('should use default display name if none provided', async () => {
      await service.setupPasskey();
      expect(prfServiceSpy.createPasskey).toHaveBeenCalledWith('Wallet User');
      expect(service.isLoggedIn()).toBe(true);
    });
  });

  it('markAuthenticated() should update state', () => {
    service.markAuthenticated();
    expect(service.isLoggedIn()).toBe(true);
  });

  it('logout() should reset state', (done) => {
    service.markAuthenticated();
    service.logout().subscribe(() => {
      expect(service.isLoggedIn()).toBe(false);
      service.getName$().subscribe(name => {
        expect(name).toBe('');
        done();
      });
    });
  });

  describe('forceLogout', () => {
    it('should navigate to login if has passkey', () => {
      prfServiceSpy.hasPasskey.mockReturnValue(true);
      service.markAuthenticated();

      service.forceLogout();

      expect(service.isLoggedIn()).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/login']);
    });

    it('should navigate to register if no passkey', () => {
      prfServiceSpy.hasPasskey.mockReturnValue(false);
      service.markAuthenticated();

      service.forceLogout();

      expect(service.isLoggedIn()).toBe(false);
      expect(routerSpy.navigate).toHaveBeenCalledWith(['/auth/register']);
    });
  });

  it('isLoggedIn$() should return an observable of authenticated state', (done) => {
    service.isLoggedIn$().subscribe(val => {
      expect(val).toBe(false);
      done();
    });
  });

  it('dispose() should do nothing', () => {
    expect(() => service.dispose()).not.toThrow();
  });
});
