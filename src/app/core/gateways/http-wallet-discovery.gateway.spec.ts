/**
 * Unit tests for HttpWalletDiscoveryGateway (EUDISTACK-502, Task 10).
 *
 * Tests covered:
 *  T-11 — fetch emits GET with correct URL and headers (AC-009.1c, AC-009.6b)
 *  T-12 — fetch errors with TimeoutError after WALLET_DISCOVERY_TIMEOUT_MS (AC-009.4c)
 *
 * Pattern: HttpTestingController intercepts the outgoing request so we can
 * assert exact URL, method, and headers without a real network call.
 * fakeAsync + tick() drives the RxJS timeout operator for T-12.
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TimeoutError } from 'rxjs';

import { WALLET_DISCOVERY_PATH } from '../constants/api.constants';
import {
  HttpWalletDiscoveryGateway,
  WALLET_DISCOVERY_TIMEOUT_MS,
} from './http-wallet-discovery.gateway';
import { WalletConfigMetadataDto } from '../models/wallet-discovery.model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid DTO for a browser-mode tenant. */
const BROWSER_DTO: WalletConfigMetadataDto = {
  wallet_mode: 'browser',
  key_manager: null,
};

/** Expected full URL based on the origin + constant used by the gateway. */
const EXPECTED_URL = `${window.location.origin}${WALLET_DISCOVERY_PATH}`;

function setup(): { gateway: HttpWalletDiscoveryGateway; httpMock: HttpTestingController } {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      HttpWalletDiscoveryGateway,
    ],
  });

  return {
    gateway: TestBed.inject(HttpWalletDiscoveryGateway),
    httpMock: TestBed.inject(HttpTestingController),
  };
}

// ---------------------------------------------------------------------------
// T-11 — fetch emits GET with correct URL and headers
// AC-009.1c, AC-009.6b
// ---------------------------------------------------------------------------

describe('HttpWalletDiscoveryGateway > fetch > emits GET with correct URL and headers', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('issues a GET to <origin>/.well-known/wallet-config-metadata', () => {
    const { gateway, httpMock } = setup();

    gateway.fetch().subscribe();

    const req = httpMock.expectOne(EXPECTED_URL);
    expect(req.request.method).toBe('GET');

    req.flush(BROWSER_DTO);
  });

  it('sends Accept: application/json header', () => {
    const { gateway, httpMock } = setup();

    gateway.fetch().subscribe();

    const req = httpMock.expectOne(EXPECTED_URL);
    expect(req.request.headers.get('Accept')).toBe('application/json');

    req.flush(BROWSER_DTO);
  });

  it('does not send an Authorization header (endpoint is public — AC-009.1c)', () => {
    const { gateway, httpMock } = setup();

    gateway.fetch().subscribe();

    const req = httpMock.expectOne(EXPECTED_URL);
    expect(req.request.headers.has('Authorization')).toBe(false);

    req.flush(BROWSER_DTO);
  });

  it('does not send an X-Tenant-Id header (endpoint is public — AC-009.1c)', () => {
    const { gateway, httpMock } = setup();

    gateway.fetch().subscribe();

    const req = httpMock.expectOne(EXPECTED_URL);
    expect(req.request.headers.has('X-Tenant-Id')).toBe(false);

    req.flush(BROWSER_DTO);
  });

  it('does not set withCredentials (no cookies — AC-009.1c)', () => {
    const { gateway, httpMock } = setup();

    gateway.fetch().subscribe();

    const req = httpMock.expectOne(EXPECTED_URL);
    expect(req.request.withCredentials).toBe(false);

    req.flush(BROWSER_DTO);
  });

  it('emits the response body exactly once and completes', () => {
    const { gateway, httpMock } = setup();

    const emitted: WalletConfigMetadataDto[] = [];
    let completed = false;

    gateway.fetch().subscribe({
      next: (dto) => emitted.push(dto),
      complete: () => { completed = true; },
    });

    const req = httpMock.expectOne(EXPECTED_URL);
    req.flush(BROWSER_DTO);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual(BROWSER_DTO);
    expect(completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-12 — fetch errors with TimeoutError after WALLET_DISCOVERY_TIMEOUT_MS
// AC-009.4c
// ---------------------------------------------------------------------------

describe('HttpWalletDiscoveryGateway > fetch > times out at 2000ms', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('WALLET_DISCOVERY_TIMEOUT_MS constant is exactly 2000', () => {
    expect(WALLET_DISCOVERY_TIMEOUT_MS).toBe(2000);
  });

  it('errors with TimeoutError when the endpoint does not respond within 2000 ms', fakeAsync(() => {
    const { gateway, httpMock } = setup();

    let caughtError: unknown;

    gateway.fetch().subscribe({
      error: (err) => { caughtError = err; },
    });

    // Advance time past the 2000 ms threshold without flushing the request.
    // The RxJS timeout operator fires and the subscriber receives TimeoutError.
    // HttpTestingController still holds the open request in its queue; we must
    // consume it before verify() or it is reported as unexpected. The request
    // was already unsubscribed by the timeout, so we use match() + error() to
    // drain it without triggering "Cannot flush a cancelled request".
    tick(WALLET_DISCOVERY_TIMEOUT_MS + 1);

    // Drain the cancelled-but-still-queued request.
    httpMock.match(EXPECTED_URL).forEach((req) => {
      if (!req.cancelled) {
        req.flush(BROWSER_DTO);
      }
    });

    httpMock.verify();

    expect(caughtError).toBeInstanceOf(TimeoutError);
  }));

  it('does not error before the 2000 ms window elapses', fakeAsync(() => {
    const { gateway, httpMock } = setup();

    let caughtError: unknown;

    gateway.fetch().subscribe({
      error: (err) => { caughtError = err; },
    });

    // Just under the threshold — no timeout yet.
    tick(WALLET_DISCOVERY_TIMEOUT_MS - 1);

    expect(caughtError).toBeUndefined();

    // Flush before the timeout fires to close the subscription cleanly.
    httpMock.expectOne(EXPECTED_URL).flush(BROWSER_DTO);
    httpMock.verify();
  }));
});
