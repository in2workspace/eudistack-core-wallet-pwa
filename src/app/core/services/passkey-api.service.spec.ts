import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { PasskeyApiService, PasskeyInfo, RegisterPasskeyRequest } from './passkey-api.service';
import { UrlResolverService } from './url-resolver.service';

describe('PasskeyApiService', () => {
  let service: PasskeyApiService;
  let httpMock: HttpTestingController;
  let urlResolverSpy: jest.Mocked<UrlResolverService>;

  const mockServerUrl = 'https://backend.example.com';
  const mockAuthBase = `${mockServerUrl}/api/v1/auth`;

  const mockPasskey: PasskeyInfo = {
    id: '1',
    credentialId: 'cred-123',
    displayName: 'My Device',
    createdAt: '2023-01-01T00:00:00Z',
    lastUsedAt: null,
    activeSessions: 1
  };

  beforeEach(() => {
    urlResolverSpy = {
      serverUrl: jest.fn().mockReturnValue(mockServerUrl)
    } as any;

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        PasskeyApiService,
        { provide: UrlResolverService, useValue: urlResolverSpy }
      ]
    });

    service = TestBed.inject(PasskeyApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('registerPasskey', () => {
    it('should POST to /passkeys', () => {
      const request: RegisterPasskeyRequest = {
        credentialId: 'cred-123',
        displayName: 'My Device',
        userAgent: 'Mozilla/5.0'
      };

      service.registerPasskey(request).subscribe(response => {
        expect(response).toEqual(mockPasskey);
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(request);
      req.flush(mockPasskey);
    });

    it('should forward the optional refreshToken in the request body', () => {
      service.registerPasskey({ credentialId: 'cred-123', displayName: 'My Device', refreshToken: 'r1' })
        .subscribe();

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys`);
      expect(req.request.body).toEqual({ credentialId: 'cred-123', displayName: 'My Device', refreshToken: 'r1' });
      req.flush(mockPasskey);
    });
  });

  describe('listPasskeys', () => {
    it('should GET from /passkeys', () => {
      const mockPasskeys: PasskeyInfo[] = [mockPasskey];

      service.listPasskeys().subscribe(response => {
        expect(response).toEqual(mockPasskeys);
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys`);
      expect(req.request.method).toBe('GET');
      req.flush(mockPasskeys);
    });
  });

  describe('renamePasskey', () => {
    it('should PATCH /passkeys/{id}', () => {
      const newName = 'Updated Device Name';
      const updatedPasskey = { ...mockPasskey, displayName: newName };

      service.renamePasskey('1', newName).subscribe(response => {
        expect(response).toEqual(updatedPasskey);
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys/1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ displayName: newName });
      req.flush(updatedPasskey);
    });
  });

  describe('deletePasskey', () => {
    it('should DELETE /passkeys/{id}', () => {
      service.deletePasskey('1').subscribe(response => {
        expect(response).toBeNull();
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys/1`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
    });
  });

  describe('revokeSessions', () => {
    it('should POST to /passkeys/{id}/revoke-sessions', () => {
      service.revokeSessions('1').subscribe(response => {
        expect(response).toBeNull();
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys/1/revoke-sessions`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(null);
    });
  });

  describe('confirmSession', () => {
    it('should POST the refresh token to /passkeys/{id}/confirm-session', () => {
      service.confirmSession('1', 'refresh-abc').subscribe(response => {
        expect(response).toBeNull();
      });

      const req = httpMock.expectOne(`${mockAuthBase}/passkeys/1/confirm-session`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ refreshToken: 'refresh-abc' });
      req.flush(null);
    });
  });
});
