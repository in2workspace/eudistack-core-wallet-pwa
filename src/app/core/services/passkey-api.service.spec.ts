import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PasskeyApiService, PasskeyInfo } from './passkey-api.service';
import { UrlResolverService } from './url-resolver.service';

describe('PasskeyApiService', () => {
  const serverUrl = 'https://backend.example.com';
  let service: PasskeyApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => serverUrl } },
      ],
    });
    service = TestBed.inject(PasskeyApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the passkeys of the account for the Signal API', () => {
    const passkeys: PasskeyInfo[] = [{ id: '1', credentialId: 'cred-123', createdAt: '2026-01-01T00:00:00Z', lastUsedAt: null }];
    let result: PasskeyInfo[] = [];

    service.listPasskeys().subscribe(list => (result = list));
    const request = http.expectOne(`${serverUrl}/api/v1/auth/passkeys`);
    request.flush(passkeys);

    expect(request.request.method).toBe('GET');
    expect(result).toEqual(passkeys);
  });

  it('does not manage devices: no rename, delete nor revoke of a passkey (EUD-15 AD-4)', () => {
    expect((service as unknown as Record<string, unknown>)['renamePasskey']).toBeUndefined();
    expect((service as unknown as Record<string, unknown>)['deletePasskey']).toBeUndefined();
    expect((service as unknown as Record<string, unknown>)['revokeSessions']).toBeUndefined();
  });
});
