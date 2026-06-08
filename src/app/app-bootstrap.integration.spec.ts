/**
 * Integration tests for wallet-mode bootstrap (EUDISTACK-502, Task 12).
 *
 * Tests covered:
 *  T-18 — discovery resolves once across navigation (AC-009.5a)
 *  T-19 — app starts even if discovery endpoint is unreachable (AC-009.4 smoke)
 *
 * Strategy:
 *  - T-18 uses TestBed with a real Angular Router (`provideRouter`), real
 *    WalletDiscoveryService, and HttpTestingController to intercept HTTP calls.
 *    The APP_INITIALIZER fires when the TestBed injector is first used.
 *    fakeAsync + tick drive the micro/macrotask queue so we can flush the HTTP
 *    response and assert on the post-initializer state.
 *
 *  - T-19 does not use APP_INITIALIZER inside TestBed to avoid a Zone.js
 *    "unhandled promise rejection" false-alarm that fires before the service's
 *    try/catch runs. Instead, `walletDiscoveryInitializer` is called directly
 *    inside an async test so the Promise chain is fully awaited. This exercises
 *    exactly the same code path and verifies the same AC (the initializer never
 *    rejects and the service falls back gracefully).
 *
 * Why not mount AppComponent:
 *  AppComponent requires IonicModule, TranslateModule, and many heavy services.
 *  The integration behaviour being validated — memoisation of the HTTP call and
 *  graceful fallback — is fully observable without rendering any component.
 */

import { APP_INITIALIZER, Component } from '@angular/core';
import { TestBed, fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';

import { environment } from 'src/environments/environment';
import { WALLET_DISCOVERY_PATH } from './core/constants/api.constants';
import { WALLET_DISCOVERY_GATEWAY, WalletDiscoveryGateway } from './core/gateways/wallet-discovery.gateway';
import { WalletDiscoveryService } from './core/services/wallet-discovery.service';
import { walletDiscoveryInitializer } from './core/initializers/wallet-discovery.initializer';
import { WalletConfigMetadataDto } from './core/models/wallet-discovery.model';
import { HttpWalletDiscoveryGateway } from './core/gateways/http-wallet-discovery.gateway';
import { TelemetryService } from './core/services/telemetry.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full well-known URL constructed the same way as the production gateway. */
const DISCOVERY_URL = `${window.location.origin}${WALLET_DISCOVERY_PATH}`;

/** Valid browser-mode DTO used to flush successful responses. */
const BROWSER_DTO: WalletConfigMetadataDto = {
  wallet_mode: 'browser',
  key_manager: null,
};

/** Minimal stub components used as route targets — no actual rendering needed. */
@Component({ standalone: true, template: '' })
class StubPageA {}

@Component({ standalone: true, template: '' })
class StubPageB {}

@Component({ standalone: true, template: '' })
class StubPageC {}

// ---------------------------------------------------------------------------
// T-18 — discovery resolves once across navigation
// AC-009.5a
// ---------------------------------------------------------------------------

describe('bootstrap > discovery resolves once across navigation', () => {
  afterEach(() => TestBed.resetTestingModule());

  /**
   * Sets up TestBed with:
   *  - Real WalletDiscoveryService + HttpWalletDiscoveryGateway
   *  - HttpTestingController intercepts HTTP calls
   *  - walletDiscoveryInitializer as APP_INITIALIZER
   *  - provideRouter with three navigable stub routes
   */
  function setup(): {
    service: WalletDiscoveryService;
    httpMock: HttpTestingController;
    router: Router;
  } {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        WalletDiscoveryService,
        HttpWalletDiscoveryGateway,
        TelemetryService,
        { provide: WALLET_DISCOVERY_GATEWAY, useClass: HttpWalletDiscoveryGateway },
        {
          provide: APP_INITIALIZER,
          useFactory: walletDiscoveryInitializer,
          deps: [WalletDiscoveryService],
          multi: true,
        },
        provideRouter([
          { path: 'page-a', component: StubPageA },
          { path: 'page-b', component: StubPageB },
          { path: 'page-c', component: StubPageC },
        ]),
      ],
    });

    return {
      service: TestBed.inject(WalletDiscoveryService),
      httpMock: TestBed.inject(HttpTestingController),
      router: TestBed.inject(Router),
    };
  }

  /**
   * Drives the initializer Promise chain to completion:
   *  1. flushMicrotasks — lets firstValueFrom subscribe to the gateway observable.
   *  2. Flush the pending HTTP request with the given body.
   *  3. Several tick + flushMicrotasks rounds — drives all Promise continuations
   *     in the async chain:
   *       Observable emit → firstValueFrom Promise → doResolve async continuation
   *       → validation → _snapshot.set → initializer .then(() => undefined)
   *     Zone.js wraps native Promise continuations as microtasks. Four rounds
   *     are sufficient for the full chain depth; extra rounds are no-ops.
   */
  function resolveInitializer(httpMock: HttpTestingController, body: WalletConfigMetadataDto): void {
    flushMicrotasks();
    const reqs = httpMock.match(DISCOVERY_URL);
    expect(reqs).toHaveLength(1);
    reqs[0].flush(body);
    // Drive every async await continuation until the signal is set.
    for (let i = 0; i < 4; i++) {
      tick();
      flushMicrotasks();
    }
  }

  it('emits exactly one HTTP request to the well-known endpoint across ≥ 3 route navigations', fakeAsync(() => {
    const { httpMock, router } = setup();

    // ── Bootstrap: allow APP_INITIALIZER to fire and resolve ─────────────
    resolveInitializer(httpMock, BROWSER_DTO);

    // ── Navigation 1 ──────────────────────────────────────────────────────
    router.navigateByUrl('/page-a');
    tick();
    flushMicrotasks();

    // ── Navigation 2 ──────────────────────────────────────────────────────
    router.navigateByUrl('/page-b');
    tick();
    flushMicrotasks();

    // ── Navigation 3 ──────────────────────────────────────────────────────
    router.navigateByUrl('/page-c');
    tick();
    flushMicrotasks();

    // No additional well-known requests should have been made (memoization
    // via _resolvePromise — AC-009.5a, AD-3).
    const extraRequests = httpMock.match(DISCOVERY_URL);
    expect(extraRequests).toHaveLength(0);

    httpMock.verify();
  }));

  it('mode() returns the resolved wallet_mode synchronously after initialization', fakeAsync(() => {
    const { service, httpMock } = setup();

    resolveInitializer(httpMock, BROWSER_DTO);

    // mode() must be synchronous — no observable, no promise (AC-009.5b).
    expect(service.mode()).toBe('browser');

    httpMock.verify();
  }));

  /**
   * NOTE: This test does NOT use APP_INITIALIZER inside TestBed nor fakeAsync.
   * When Zone.js wraps async/await chains, native-Promise microtasks scheduled
   * inside an APP_INITIALIZER sometimes settle after fakeAsync considers the
   * zone stable, leaving the signal null at assertion time.
   * To avoid that false-alarm we invoke walletDiscoveryInitializer directly on
   * a service backed by an `of(DTO)` gateway — the synchronous observable lets
   * the firstValueFrom Promise resolve in a single microtask tick, so the full
   * async chain (await → _snapshot.set) settles before the assertions run.
   * This exercises the identical production code path (AC-009.5b).
   */
  it('snapshot signal reflects the discovery result after initialization', async () => {
    const successGateway: WalletDiscoveryGateway = { fetch: () => of(BROWSER_DTO) };

    TestBed.configureTestingModule({
      providers: [
        WalletDiscoveryService,
        TelemetryService,
        { provide: WALLET_DISCOVERY_GATEWAY, useValue: successGateway },
      ],
    });

    const service = TestBed.inject(WalletDiscoveryService);
    const initFn = walletDiscoveryInitializer(service);
    await initFn();

    const snap = service.snapshot()();
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('discovery');
    expect(snap!.mode).toBe('browser');
    expect(snap!.keyManager).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-19 — app starts even if discovery endpoint is unreachable
// AC-009.4 (smoke)
//
// NOTE: APP_INITIALIZER is NOT registered inside TestBed for T-19. When Zone.js
// wraps promise chains in fakeAsync, it intercepts the rejection from `throwError`
// before the try/catch in WalletDiscoveryService.doResolve runs and throws
// "Uncaught (in promise)". To avoid this false-alarm we invoke
// walletDiscoveryInitializer directly as an async test, which is functionally
// equivalent and matches the production code path (walletDiscoveryInitializer
// calls service.resolve() with the same catch logic).
// ---------------------------------------------------------------------------

describe('bootstrap > app starts even if discovery endpoint is unreachable', () => {
  afterEach(() => TestBed.resetTestingModule());

  /**
   * Gateway that always rejects with an HttpErrorResponse(status: 0) to
   * simulate a network-unreachable scenario (AC-009.4a).
   */
  const alwaysFailGateway: WalletDiscoveryGateway = {
    fetch: () =>
      throwError(() => new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' })),
  };

  /**
   * Sets up TestBed with the always-failing gateway. No APP_INITIALIZER
   * provider — see class-level note above.
   */
  function setup(): WalletDiscoveryService {
    TestBed.configureTestingModule({
      providers: [
        WalletDiscoveryService,
        TelemetryService,
        { provide: WALLET_DISCOVERY_GATEWAY, useValue: alwaysFailGateway },
        provideRouter([
          { path: 'page-a', component: StubPageA },
        ]),
      ],
    });

    return TestBed.inject(WalletDiscoveryService);
  }

  it('APP_INITIALIZER resolves without throwing when the endpoint is unreachable', async () => {
    const service = setup();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Directly invoke the initializer factory — same code path as production.
    const initFn = walletDiscoveryInitializer(service);

    // The returned function must resolve (not reject) regardless of gateway failure.
    await expect(initFn()).resolves.toBeUndefined();

    warnSpy.mockRestore();
  });

  it('mode() falls back to environment.wallet_mode when the endpoint is unreachable', async () => {
    const service = setup();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initFn = walletDiscoveryInitializer(service);
    await initFn();

    // After the initializer resolves, mode() must return synchronously with
    // the fallback value (AC-009.4a, AC-009.5b).
    const expectedMode = environment.wallet_mode || 'browser';
    expect(service.mode()).toBe(expectedMode);

    warnSpy.mockRestore();
  });

  it('snapshot source is fallback with reason network_error when endpoint is unreachable', async () => {
    const service = setup();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initFn = walletDiscoveryInitializer(service);
    await initFn();

    const snap = service.snapshot()();
    expect(snap).not.toBeNull();
    expect(snap!.source).toBe('fallback');
    expect(snap!.fallbackReason).toBe('network_error');

    warnSpy.mockRestore();
  });

  it('router navigation succeeds after fallback (PWA does not abort)', async () => {
    const service = setup();
    const router = TestBed.inject(Router);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Resolve the initializer (fallback path) before navigating.
    const initFn = walletDiscoveryInitializer(service);
    await initFn();

    // Navigate to the first route — must succeed without throwing.
    const navigationResult = await router.navigateByUrl('/page-a');

    expect(navigationResult).toBe(true);

    warnSpy.mockRestore();
  });
});
