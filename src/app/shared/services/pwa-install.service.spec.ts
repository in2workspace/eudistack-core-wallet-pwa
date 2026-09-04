import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { INSTALL_DECISION_HARD_TIMEOUT_MS, PwaInstallService } from './pwa-install.service';

/** Minimal EventTarget-compatible stub so rxjs `fromEvent` can attach to it. */
function createServiceWorkerContainerStub(controller: unknown | null) {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    controller,
    addEventListener: (type: string, cb: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(cb);
    },
    removeEventListener: (type: string, cb: EventListener) => {
      listeners.get(type)?.delete(cb);
    },
    dispatchEvent: (evt: Event) => {
      listeners.get(evt.type)?.forEach((cb) => cb(evt));
      return true;
    },
  };
}

function defineServiceWorker(value: unknown): void {
  Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true, writable: true });
}

function removeServiceWorker(): void {
  delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
}

function defineUserAgent(value: string): void {
  Object.defineProperty(navigator, 'userAgent', { value, configurable: true });
}

function defineMatchMedia(matches: boolean): void {
  // setup-jest.ts declares window.matchMedia as writable (not configurable) —
  // plain assignment works, Object.defineProperty would throw.
  window.matchMedia = (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
}

const DEFAULT_USER_AGENT = navigator.userAgent;

describe('PwaInstallService > installDecision$', () => {
  afterEach(() => {
    removeServiceWorker();
    defineUserAgent(DEFAULT_USER_AGENT);
    defineMatchMedia(false);
    TestBed.resetTestingModule();
  });

  it('resolves false immediately when running standalone', fakeAsync(() => {
    removeServiceWorker();
    defineMatchMedia(true);

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    expect(emitted).toBe(false);
  }));

  it('resolves false immediately on iOS', fakeAsync(() => {
    removeServiceWorker();
    defineUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    expect(emitted).toBe(false);
  }));

  it('resolves true when beforeinstallprompt fires before the hard ceiling', fakeAsync(() => {
    removeServiceWorker();

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt'), {}));
    tick(0);

    expect(emitted).toBe(true);
  }));

  it('resolves false after the SW grace period when the SW already controls the page', fakeAsync(() => {
    defineServiceWorker(createServiceWorkerContainerStub({}));

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    tick(499);
    expect(emitted).toBeUndefined();

    tick(1);
    expect(emitted).toBe(false);
  }));

  it('resolves false after controllerchange + grace period when the SW does not control the page yet', fakeAsync(() => {
    const swStub = createServiceWorkerContainerStub(null);
    defineServiceWorker(swStub);

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    tick(2000);
    expect(emitted).toBeUndefined();

    swStub.dispatchEvent(new Event('controllerchange'));
    tick(499);
    expect(emitted).toBeUndefined();

    tick(1);
    expect(emitted).toBe(false);
  }));

  it('resolves false at the hard ceiling (not before) when neither the SW nor the install prompt ever show up — the reported hang', fakeAsync(() => {
    defineServiceWorker(createServiceWorkerContainerStub(null));

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    tick(INSTALL_DECISION_HARD_TIMEOUT_MS - 1);
    expect(emitted).toBeUndefined();

    tick(1);
    expect(emitted).toBe(false);
  }));

  it('INSTALL_DECISION_HARD_TIMEOUT_MS constant is exactly 4000', () => {
    expect(INSTALL_DECISION_HARD_TIMEOUT_MS).toBe(4000);
  });
});
