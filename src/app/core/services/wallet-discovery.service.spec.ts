/**
 * Unit tests for WalletDiscoveryService (EUDISTACK-502, Task 9).
 *
 * Tests covered:
 *  T-1  — resolve returns mode from gateway response (AC-009.2a, AC-009.3a, AC-009.6a)
 *  T-2  — fallback on network error, status 0 (AC-009.4a)
 *  T-3  — fallback on HTTP 404 (AC-009.4b)
 *  T-4  — fallback on HTTP 500 (AC-009.4b)
 *  T-5  — fallback on timeout > 2 s (AC-009.4c)
 *  T-6  — fallback on invalid payload shapes (AC-009.4d, E-3, E-4)
 *  T-7  — resolve memoizes and does not re-fetch (AC-009.5a)
 *  T-8  — defaults to browser when environment.wallet_mode is invalid (E-1, E-2)
 *  T-9  — telemetry events emitted correctly (AC-009.4e)
 *  T-10 — mode() returns env fallback when read before resolve (AC-009.5c)
 *  T-13 — walletDiscoveryInitializer resolves the promise (AC-009.1a)
 *
 * Test pattern: fake gateway injected via WALLET_DISCOVERY_GATEWAY token.
 * No HttpClient, no environment.ts mocking required (AC-009.6c).
 */

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, throwError, of } from 'rxjs';
import { TimeoutError } from 'rxjs';

import { WalletDiscoveryService } from './wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY, WalletDiscoveryGateway } from '../gateways/wallet-discovery.gateway';
import { WalletConfigMetadataDto } from '../models/wallet-discovery.model';
import { TelemetryService } from './telemetry.service';
import { walletDiscoveryInitializer } from '../initializers/wallet-discovery.initializer';
import { environment } from 'src/environments/environment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid DTO for a browser-mode tenant. */
const BROWSER_DTO: WalletConfigMetadataDto = {
  wallet_mode: 'browser',
  natural_persons_only: false,
  supported_credentials: [],
  version: 1,
};

/** Valid DTO for a server-mode tenant. */
const SERVER_DTO: WalletConfigMetadataDto = {
  wallet_mode: 'server',
  natural_persons_only: true,
  supported_credentials: ['LEARCredentialEmployee'],
  version: 2,
};

/** Creates a fake gateway that emits the given DTO synchronously. */
function makeSuccessGateway(dto: WalletConfigMetadataDto): WalletDiscoveryGateway {
  return { fetch: () => of(dto) };
}

/** Creates a fake gateway that errors with the given error. */
function makeErrorGateway(error: unknown): WalletDiscoveryGateway {
  return { fetch: () => throwError(() => error) };
}

/** Creates a fake gateway whose Subject never emits (simulates hanging endpoint). */
function makePendingGateway(): { gateway: WalletDiscoveryGateway; subject: Subject<WalletConfigMetadataDto> } {
  const subject = new Subject<WalletConfigMetadataDto>();
  return { gateway: { fetch: () => subject.asObservable() }, subject };
}

/**
 * Configures TestBed with WalletDiscoveryService and a fake gateway.
 * TelemetryService is replaced by a spy-able stub.
 */
function configureTestBed(gateway: WalletDiscoveryGateway): void {
  TestBed.configureTestingModule({
    providers: [
      WalletDiscoveryService,
      { provide: WALLET_DISCOVERY_GATEWAY, useValue: gateway },
      TelemetryService,
    ],
  });
}

// ---------------------------------------------------------------------------
// T-1 — resolve returns mode from gateway response
// AC-009.2a, AC-009.3a, AC-009.5b, AC-009.6a
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > returns mode from gateway response', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('resolves to browser mode and populates the snapshot signal', async () => {
    configureTestBed(makeSuccessGateway(BROWSER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);

    const snapshot = await service.resolve();

    expect(snapshot.mode).toBe('browser');
    expect(snapshot.source).toBe('discovery');
    expect(snapshot.version).toBe(1);
    expect(snapshot.naturalPersonsOnly).toBe(false);
    expect(snapshot.supportedCredentials).toEqual([]);
    expect(snapshot.fallbackReason).toBeUndefined();
    // signal is updated
    expect(service.snapshot()()).toEqual(snapshot);
    // mode() reads from the signal synchronously after resolve
    expect(service.mode()).toBe('browser');
  });

  it('resolves to server mode with the correct snapshot fields', async () => {
    configureTestBed(makeSuccessGateway(SERVER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);

    const snapshot = await service.resolve();

    expect(snapshot.mode).toBe('server');
    expect(snapshot.source).toBe('discovery');
    expect(snapshot.version).toBe(2);
    expect(snapshot.naturalPersonsOnly).toBe(true);
    expect(snapshot.supportedCredentials).toEqual(['LEARCredentialEmployee']);
    expect(service.mode()).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// T-2 — fallback on network error (status === 0)
// AC-009.4a
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > falls back to environment on network error', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('applies fallback with reason network_error when status is 0', async () => {
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const service = TestBed.inject(WalletDiscoveryService);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    expect(snapshot.source).toBe('fallback');
    expect(snapshot.fallbackReason).toBe('network_error');
    // mode falls back to environment.wallet_mode (default 'browser' in test env)
    expect(snapshot.mode).toBe(environment.wallet_mode || 'browser');
    expect(snapshot.version).toBeNull();
    expect(snapshot.naturalPersonsOnly).toBe(false);
    expect(snapshot.supportedCredentials).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      '[WalletDiscovery] fallback to environment.wallet_mode',
      { reason: 'network_error' },
    );

    warnSpy.mockRestore();
  });

  it('promise always resolves (never rejects) on network error', async () => {
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(service.resolve()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T-3 — fallback on HTTP 404
// AC-009.4b
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > falls back on HTTP 404', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('applies fallback with reason http_error on 404', async () => {
    const notFoundError = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
    configureTestBed(makeErrorGateway(notFoundError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    expect(snapshot.source).toBe('fallback');
    expect(snapshot.fallbackReason).toBe('http_error');
  });

  it('promise always resolves on 404', async () => {
    const notFoundError = new HttpErrorResponse({ status: 404, statusText: 'Not Found' });
    configureTestBed(makeErrorGateway(notFoundError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(service.resolve()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T-4 — fallback on HTTP 500
// AC-009.4b
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > falls back on HTTP 500', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('applies fallback with reason http_error on 500', async () => {
    const serverError = new HttpErrorResponse({
      status: 500,
      statusText: 'Internal Server Error',
    });
    configureTestBed(makeErrorGateway(serverError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    expect(snapshot.source).toBe('fallback');
    expect(snapshot.fallbackReason).toBe('http_error');
  });
});

// ---------------------------------------------------------------------------
// T-5 — fallback on timeout > 2 s
// AC-009.4c
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > falls back on timeout > 2s', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('applies fallback with reason timeout when gateway emits TimeoutError', async () => {
    // The actual timeout operator lives in HttpWalletDiscoveryGateway.
    // Here we simulate what happens when the gateway errors with TimeoutError
    // (as it would after 2 s), and verify WalletDiscoveryService classifies it
    // correctly as 'timeout'.
    configureTestBed(makeErrorGateway(new TimeoutError()));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    expect(snapshot.source).toBe('fallback');
    expect(snapshot.fallbackReason).toBe('timeout');
  });

  it('promise resolves (does not reject) on timeout', async () => {
    configureTestBed(makeErrorGateway(new TimeoutError()));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(service.resolve()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// T-6 — fallback on invalid payload shapes
// AC-009.4d, E-3, E-4
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > rejects invalid payload shapes', () => {
  const invalidPayloads: Array<{ label: string; dto: unknown }> = [
    { label: 'null body',                  dto: null },
    { label: 'array body',                 dto: [] },
    { label: 'missing wallet_mode field',  dto: { foo: 1, natural_persons_only: true, supported_credentials: [], version: 1 } },
    { label: 'unrecognised wallet_mode',   dto: { wallet_mode: 'lunatic', natural_persons_only: false, supported_credentials: [], version: 1 } },
    { label: 'empty object',              dto: {} },
    { label: 'wallet_mode is a number',   dto: { wallet_mode: 1, natural_persons_only: false, supported_credentials: [], version: 1 } },
  ];

  afterEach(() => TestBed.resetTestingModule());

  invalidPayloads.forEach(({ label, dto }) => {
    it(`applies fallback with reason invalid_payload for: ${label}`, async () => {
      // Use a gateway that emits the invalid payload as if it were a valid Observable
      const invalidGateway: WalletDiscoveryGateway = {
        fetch: () => of(dto as WalletConfigMetadataDto),
      };

      TestBed.configureTestingModule({
        providers: [
          WalletDiscoveryService,
          { provide: WALLET_DISCOVERY_GATEWAY, useValue: invalidGateway },
          TelemetryService,
        ],
      });

      const service = TestBed.inject(WalletDiscoveryService);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      const snapshot = await service.resolve();

      expect(snapshot.source).toBe('fallback');
      expect(snapshot.fallbackReason).toBe('invalid_payload');

      TestBed.resetTestingModule();
    });
  });
});

// ---------------------------------------------------------------------------
// T-7 — memoization: resolve called twice fires gateway exactly once
// AC-009.5a, AD-3
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > memoizes the result and does not re-fetch', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('calls gateway.fetch exactly once even when resolve() is called multiple times', async () => {
    const fetchSpy = jest.fn().mockReturnValue(of(BROWSER_DTO));
    const memoGateway: WalletDiscoveryGateway = { fetch: fetchSpy };
    configureTestBed(memoGateway);
    const service = TestBed.inject(WalletDiscoveryService);

    const [snap1, snap2, snap3] = await Promise.all([
      service.resolve(),
      service.resolve(),
      service.resolve(),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(snap1).toBe(snap2);
    expect(snap2).toBe(snap3);
  });

  it('returns the same snapshot on a sequential second call', async () => {
    const fetchSpy = jest.fn().mockReturnValue(of(SERVER_DTO));
    configureTestBed({ fetch: fetchSpy });
    const service = TestBed.inject(WalletDiscoveryService);

    const first = await service.resolve();
    const second = await service.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });
});

// ---------------------------------------------------------------------------
// T-8 — defaults to 'browser' when environment.wallet_mode is invalid
// E-1, E-2, AD-5
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > defaults to browser if env wallet_mode invalid', () => {
  let originalWalletMode: string;

  beforeEach(() => {
    originalWalletMode = environment.wallet_mode as string;
  });

  afterEach(() => {
    (environment as { wallet_mode: string }).wallet_mode = originalWalletMode;
    TestBed.resetTestingModule();
  });

  it('defaults to browser when environment.wallet_mode is an unrecognised string (E-2)', async () => {
    (environment as { wallet_mode: string }).wallet_mode = 'lunatic';
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const service = TestBed.inject(WalletDiscoveryService);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    expect(snapshot.mode).toBe('browser');
    expect(snapshot.source).toBe('fallback');
    // At minimum one warn for the invalid env value
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('defaults to browser when environment.wallet_mode is an empty string (E-1)', async () => {
    (environment as { wallet_mode: string }).wallet_mode = '';
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const snapshot = await service.resolve();

    // The snapshot fallbackReason records why the well-known call failed ('network_error').
    // The cascade to default 'browser' happens silently because env is also empty (E-1).
    expect(snapshot.mode).toBe('browser');
    expect(snapshot.source).toBe('fallback');
    // fallbackReason is the HTTP-level reason (network_error), not the env-cascade reason
    expect(snapshot.fallbackReason).toBe('network_error');
  });
});

// ---------------------------------------------------------------------------
// T-9 — telemetry events emitted correctly
// AC-009.4e
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > resolve > emits telemetry events', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('emits wallet_discovery_resolved with mode and version on success', async () => {
    configureTestBed(makeSuccessGateway(BROWSER_DTO));
    const telemetry = TestBed.inject(TelemetryService);
    const trackSpy = jest.spyOn(telemetry, 'track');
    const service = TestBed.inject(WalletDiscoveryService);

    await service.resolve();

    expect(trackSpy).toHaveBeenCalledWith('wallet_discovery_resolved', {
      mode: 'browser',
      version: 1,
    });
    expect(trackSpy).not.toHaveBeenCalledWith('wallet_discovery_fallback', expect.anything());
  });

  it('emits wallet_discovery_fallback with reason on network error', async () => {
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const telemetry = TestBed.inject(TelemetryService);
    const trackSpy = jest.spyOn(telemetry, 'track');
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.resolve();

    expect(trackSpy).toHaveBeenCalledWith('wallet_discovery_fallback', {
      reason: 'network_error',
    });
    expect(trackSpy).not.toHaveBeenCalledWith('wallet_discovery_resolved', expect.anything());
  });

  it('emits wallet_discovery_fallback with reason timeout on TimeoutError', async () => {
    configureTestBed(makeErrorGateway(new TimeoutError()));
    const telemetry = TestBed.inject(TelemetryService);
    const trackSpy = jest.spyOn(telemetry, 'track');
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.resolve();

    expect(trackSpy).toHaveBeenCalledWith('wallet_discovery_fallback', { reason: 'timeout' });
  });

  it('emits wallet_discovery_fallback with reason invalid_payload on bad body', async () => {
    const invalidGateway: WalletDiscoveryGateway = {
      fetch: () => of({ foo: 'bar' } as unknown as WalletConfigMetadataDto),
    };
    TestBed.configureTestingModule({
      providers: [
        WalletDiscoveryService,
        { provide: WALLET_DISCOVERY_GATEWAY, useValue: invalidGateway },
        TelemetryService,
      ],
    });
    const telemetry = TestBed.inject(TelemetryService);
    const trackSpy = jest.spyOn(telemetry, 'track');
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.resolve();

    expect(trackSpy).toHaveBeenCalledWith('wallet_discovery_fallback', {
      reason: 'invalid_payload',
    });
  });
});

// ---------------------------------------------------------------------------
// T-10 — mode() returns environment value if read before resolve
// AC-009.5c
// ---------------------------------------------------------------------------

describe('WalletDiscoveryService > mode > returns environment value if read before resolve', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('returns environment.wallet_mode before resolve() is called', () => {
    configureTestBed(makeSuccessGateway(BROWSER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Do NOT call resolve() — read mode() immediately after construction
    const result = service.mode();

    // Must return a valid WalletMode (browser or server) derived from environment
    expect(['browser', 'server']).toContain(result);
    // Must have emitted the pre-initializer warning (AC-009.5c)
    expect(warnSpy).toHaveBeenCalledWith(
      '[WalletDiscovery] mode() read before initializer resolved',
    );

    warnSpy.mockRestore();
  });

  it('returns the resolved mode after resolve() completes, without the warning', async () => {
    configureTestBed(makeSuccessGateway(SERVER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await service.resolve();
    const result = service.mode();

    expect(result).toBe('server');
    // No pre-initializer warning after resolve
    expect(warnSpy).not.toHaveBeenCalledWith(
      '[WalletDiscovery] mode() read before initializer resolved',
    );

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// T-13 — walletDiscoveryInitializer resolves the promise before returning
// AC-009.1a
// ---------------------------------------------------------------------------

describe('walletDiscoveryInitializer > runs before router activation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('factory returns a function that resolves to void when service resolves', async () => {
    configureTestBed(makeSuccessGateway(BROWSER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);

    const initFn = walletDiscoveryInitializer(service);
    const result = await initFn();

    // The initializer must return void (undefined), not the snapshot
    expect(result).toBeUndefined();
  });

  it('factory function resolves even when service.resolve() would fallback (gateway error)', async () => {
    const networkError = new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' });
    configureTestBed(makeErrorGateway(networkError));
    const service = TestBed.inject(WalletDiscoveryService);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initFn = walletDiscoveryInitializer(service);

    // The promise must resolve (not reject) even on network failure (no-abort guarantee)
    await expect(initFn()).resolves.toBeUndefined();
  });

  it('snapshot is committed before the initializer promise resolves', async () => {
    configureTestBed(makeSuccessGateway(SERVER_DTO));
    const service = TestBed.inject(WalletDiscoveryService);

    const initFn = walletDiscoveryInitializer(service);
    await initFn();

    // After initFn() resolves, the snapshot signal must be populated
    expect(service.snapshot()()).not.toBeNull();
    expect(service.snapshot()()!.mode).toBe('server');
  });

  it('catches unexpected errors from resolve() and still resolves to void', async () => {
    // Simulate a programming error that bypasses the internal catch in service
    const brokenService = {
      resolve: () => Promise.reject(new Error('unexpected crash')),
    } as unknown as WalletDiscoveryService;

    const initFn = walletDiscoveryInitializer(brokenService);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(initFn()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[WalletDiscovery] initializer crashed unexpectedly',
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });
});
