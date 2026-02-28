import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { AuthService, TokenPairResponse, VerifyEmailResponse } from './auth.service';
import { environment } from 'src/environments/environment';

const AUTH_BASE = `${environment.server_url}/api/v1/auth`;

class BroadcastChannelMock {
  name: string;
  onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null = null;
  constructor(name: string) {
    this.name = name;
  }
  postMessage(_message: any) {}
  close() {}
}

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let routerMock: jest.Mocked<Router>;

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = BroadcastChannelMock;
  });

  beforeEach(() => {
    localStorage.clear();

    routerMock = {
      navigate: jest.fn(),
    } as unknown as jest.Mocked<Router>;

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: Router, useValue: routerMock },
      ],
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('register', () => {
    it('should POST to /register', (done) => {
      service.register('test@example.com').subscribe((res) => {
        expect(res.message).toBe('ok');
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/register`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'test@example.com' });
      req.flush({ message: 'ok' });
    });
  });

  describe('verifyEmail', () => {
    it('should POST to /verify-email and store temp token', (done) => {
      const response: VerifyEmailResponse = { userId: 'uuid-1', tempToken: 'temp-123' };

      service.verifyEmail('test@example.com', '123456').subscribe((res) => {
        expect(res.tempToken).toBe('temp-123');
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/verify-email`);
      expect(req.request.body).toEqual({ email: 'test@example.com', code: '123456' });
      req.flush(response);
    });
  });

  describe('startLogin', () => {
    it('should POST to /login/start', (done) => {
      const options = { challenge: 'abc' };

      service.startLogin('test@example.com').subscribe((res) => {
        expect(res.challenge).toBe('abc');
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/login/start`);
      expect(req.request.body).toEqual({ email: 'test@example.com' });
      req.flush(JSON.stringify(options));
    });
  });

  describe('finishLogin', () => {
    it('should POST to /login/finish and store tokens', (done) => {
      const tokenResponse: TokenPairResponse = {
        accessToken: 'eyJhbGciOiJSUzI1NiJ9.' + btoa(JSON.stringify({ sub: 'uuid-1', email: 'user@test.com' })) + '.sig',
        refreshToken: 'refresh-xyz',
        expiresIn: 900,
      };

      service.finishLogin('cred-json', 'opts-json').subscribe((res) => {
        expect(service.getToken()).toBe(tokenResponse.accessToken);
        expect(service.isLoggedIn()).toBe(true);
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/login/finish`);
      expect(req.request.body).toEqual({ credential: 'cred-json', options: 'opts-json' });
      req.flush(tokenResponse);
    });
  });

  describe('logout', () => {
    it('should POST to /logout and clear state', (done) => {
      // Simulate logged-in state
      (service as any).refreshTokenValue = 'refresh-123';
      (service as any).accessToken = 'access-456';
      (service as any).authenticated$.next(true);

      service.logout().subscribe(() => {
        expect(service.getToken()).toBe('');
        expect(service.isLoggedIn()).toBe(false);
        done();
      });

      const req = httpMock.expectOne(`${AUTH_BASE}/logout`);
      expect(req.request.body).toEqual({ refreshToken: 'refresh-123' });
      req.flush(null);
    });

    it('should clear state even without refresh token', (done) => {
      service.logout().subscribe(() => {
        expect(service.isLoggedIn()).toBe(false);
        done();
      });
    });
  });

  describe('forceLogout', () => {
    it('should clear state and navigate to login', () => {
      (service as any).accessToken = 'some-token';
      (service as any).authenticated$.next(true);

      service.forceLogout();

      expect(service.getToken()).toBe('');
      expect(service.isLoggedIn()).toBe(false);
      expect(routerMock.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('getToken', () => {
    it('should return empty string when not authenticated', () => {
      expect(service.getToken()).toBe('');
    });
  });

  describe('getName$', () => {
    it('should emit empty string initially', (done) => {
      service.getName$().subscribe((name) => {
        expect(name).toBe('');
        done();
      });
    });
  });

  describe('cross-tab logout', () => {
    it('should listen to broadcast channel messages', () => {
      const channel = (service as any).broadcastChannel;
      expect(channel.onmessage).toBeTruthy();
    });
  });

  it('should close broadcast channel on destroy', () => {
    const closeSpy = jest.spyOn((service as any).broadcastChannel, 'close');
    service.ngOnDestroy();
    expect(closeSpy).toHaveBeenCalled();
  });
});
