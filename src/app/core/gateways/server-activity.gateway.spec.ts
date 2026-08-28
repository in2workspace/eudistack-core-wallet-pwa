import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ServerActivityGateway } from './server-activity.gateway';
import { UrlResolverService } from '../services/url-resolver.service';
import { ActivityEntry, ServerActivityDto } from '../models/activity.model';

const SERVER_BASE = 'https://tenant.example.com';
const ACTIVITY_URL = `${SERVER_BASE}/api/v1/activity`;

function setup(): { gateway: ServerActivityGateway; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      ServerActivityGateway,
      { provide: UrlResolverService, useValue: { serverUrl: () => SERVER_BASE } },
    ],
  });
  return {
    gateway: TestBed.inject(ServerActivityGateway),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

describe('ServerActivityGateway', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  describe('list()', () => {
    it('GETs /api/v1/activity and maps server types/fields to client types (EC-05)', (done) => {
      const { gateway, httpMock } = setup();
      const dtos: ServerActivityDto[] = [
        {
          id: '1',
          type: 'ISSUED',
          credential_name: 'Cred A',
          counterparty: 'issuer-a',
          created_at: '2026-07-20T10:00:00.000Z',
        },
        {
          id: '2',
          type: 'PRESENTED',
          credential_name: 'Cred B',
          counterparty: 'verifier-b',
          created_at: '2026-07-21T10:00:00.000Z',
          details: 'attrs',
          shared_attributes: ['firstName', 'lastName'],
        },
        {
          id: '3',
          type: 'DELETED',
          credential_name: 'Cred C',
          counterparty: 'issuer-c',
          created_at: '2026-07-22T10:00:00.000Z',
        },
      ];

      gateway.list().subscribe((entries) => {
        expect(entries).toEqual<ActivityEntry[]>([
          {
            id: '1',
            type: 'issued',
            credentialName: 'Cred A',
            counterparty: 'issuer-a',
            timestamp: Date.parse('2026-07-20T10:00:00.000Z'),
          },
          {
            id: '2',
            type: 'presented',
            credentialName: 'Cred B',
            counterparty: 'verifier-b',
            timestamp: Date.parse('2026-07-21T10:00:00.000Z'),
            details: 'attrs',
            sharedAttributes: ['firstName', 'lastName'],
          },
          {
            id: '3',
            type: 'deleted',
            credentialName: 'Cred C',
            counterparty: 'issuer-c',
            timestamp: Date.parse('2026-07-22T10:00:00.000Z'),
          },
        ]);
        done();
      });

      const req = httpMock.expectOne(ACTIVITY_URL);
      expect(req.request.method).toBe('GET');
      req.flush(dtos);
    });

    it('returns an empty array when the server has no history (EC-04)', (done) => {
      const { gateway, httpMock } = setup();

      gateway.list().subscribe((entries) => {
        expect(entries).toEqual([]);
        done();
      });

      httpMock.expectOne(ACTIVITY_URL).flush([]);
    });
  });

  describe('append()', () => {
    it('POSTs the mapped request DTO (snake_case, no client timestamp) to /api/v1/activity (AC-04)', () => {
      const { gateway, httpMock } = setup();
      const entry: ActivityEntry = {
        id: 'abc-123',
        type: 'issued',
        credentialName: 'LEARCredentialEmployee',
        counterparty: 'https://issuer.example.com',
        timestamp: Date.parse('2026-07-22T08:00:00.000Z'),
      };

      gateway.append(entry).subscribe();

      const req = httpMock.expectOne(ACTIVITY_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        id: 'abc-123',
        type: 'ISSUED',
        credential_name: 'LEARCredentialEmployee',
        counterparty: 'https://issuer.example.com',
      });
      // The server assigns created_at itself — the request must never carry a client timestamp.
      expect(req.request.body.occurredAt).toBeUndefined();
      expect(req.request.body.created_at).toBeUndefined();

      req.flush(
        {
          id: 'abc-123',
          type: 'ISSUED',
          credential_name: 'LEARCredentialEmployee',
          counterparty: 'https://issuer.example.com',
          created_at: '2026-07-22T08:00:01.000Z',
        },
        { status: 201, statusText: 'Created' },
      );
    });

    it('includes shared_attributes when present on the entry', () => {
      const { gateway, httpMock } = setup();
      const entry: ActivityEntry = {
        id: 'abc-124',
        type: 'presented',
        credentialName: 'LEARCredentialEmployee',
        counterparty: 'https://verifier.example.com',
        timestamp: Date.now(),
        sharedAttributes: ['firstName', 'email'],
      };

      gateway.append(entry).subscribe();

      const req = httpMock.expectOne(ACTIVITY_URL);
      expect(req.request.body.shared_attributes).toEqual(['firstName', 'email']);
      req.flush(null, { status: 201, statusText: 'Created' });
    });

    it('completes on a duplicate (already existed — idempotent registration, EC-01)', (done) => {
      const { gateway, httpMock } = setup();
      const entry: ActivityEntry = {
        id: 'abc-123',
        type: 'deleted',
        credentialName: 'Cred X',
        counterparty: 'issuer-x',
        timestamp: Date.now(),
      };

      gateway.append(entry).subscribe({ complete: done });

      httpMock.expectOne(ACTIVITY_URL).flush(
        {
          id: 'abc-123',
          type: 'DELETED',
          credential_name: 'Cred X',
          counterparty: 'issuer-x',
          created_at: '2026-07-22T08:00:00.000Z',
        },
        { status: 201, statusText: 'Created' },
      );
    });
  });
});
