import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PasskeyPrfAuditService } from './passkey-prf-audit.service';
import { UrlResolverService } from './url-resolver.service';

const SERVER_BASE = 'https://tenant.example.com';

function setup(): { service: PasskeyPrfAuditService; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      PasskeyPrfAuditService,
      { provide: UrlResolverService, useValue: { serverUrl: () => SERVER_BASE } },
    ],
  });
  return {
    service: TestBed.inject(PasskeyPrfAuditService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('PasskeyPrfAuditService', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('POSTs to /api/v1/keys/passkey-prf/constraint-accepted with empty body', () => {
    const { service, httpMock } = setup();

    service.recordConstraintAccepted().subscribe();

    const req = httpMock.expectOne(`${SERVER_BASE}/api/v1/keys/passkey-prf/constraint-accepted`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('returns an Observable that completes on 204', (done) => {
    const { service, httpMock } = setup();

    service.recordConstraintAccepted().subscribe({ complete: done });

    httpMock
      .expectOne(`${SERVER_BASE}/api/v1/keys/passkey-prf/constraint-accepted`)
      .flush(null, { status: 204, statusText: 'No Content' });
  });
});
