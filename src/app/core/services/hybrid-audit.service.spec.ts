import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HybridAuditService } from './hybrid-audit.service';
import { UrlResolverService } from './url-resolver.service';

const SERVER_BASE = 'https://tenant.example.com';

function setup(): { service: HybridAuditService; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      HybridAuditService,
      { provide: UrlResolverService, useValue: { serverUrl: () => SERVER_BASE } },
    ],
  });
  return {
    service: TestBed.inject(HybridAuditService),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('HybridAuditService', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('POSTs to /api/v1/keys/hybrid/constraint-accepted with empty body', () => {
    const { service, httpMock } = setup();

    service.recordConstraintAccepted().subscribe();

    const req = httpMock.expectOne(`${SERVER_BASE}/api/v1/keys/hybrid/constraint-accepted`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('returns an Observable that completes on 204', (done) => {
    const { service, httpMock } = setup();

    service.recordConstraintAccepted().subscribe({ complete: done });

    httpMock
      .expectOne(`${SERVER_BASE}/api/v1/keys/hybrid/constraint-accepted`)
      .flush(null, { status: 204, statusText: 'No Content' });
  });
});
