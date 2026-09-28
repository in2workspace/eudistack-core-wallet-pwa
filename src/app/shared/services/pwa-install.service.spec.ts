import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import {
  INSTALL_DECISION_HARD_TIMEOUT_MS,
  POST_UPDATE_STANDALONE_GRACE_KEY,
  PwaInstallService,
} from './pwa-install.service';

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
    sessionStorage.removeItem(POST_UPDATE_STANDALONE_GRACE_KEY);
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

const MAC_SAFARI_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const MAC_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function defineMaxTouchPoints(value: number): void {
  Object.defineProperty(navigator, 'maxTouchPoints', { value, configurable: true });
}

describe('PwaInstallService > macOS Safari manual install', () => {
  afterEach(() => {
    removeServiceWorker();
    defineUserAgent(DEFAULT_USER_AGENT);
    defineMatchMedia(false);
    defineMaxTouchPoints(0);
    TestBed.resetTestingModule();
  });

  it('flags macOS Safari, where beforeinstallprompt is never emitted', () => {
    defineUserAgent(MAC_SAFARI_UA);
    defineMaxTouchPoints(0);

    expect(TestBed.inject(PwaInstallService).isMacSafari).toBe(true);
  });

  it('resolves true immediately on macOS Safari, without waiting for a prompt that cannot arrive', fakeAsync(() => {
    removeServiceWorker();
    defineUserAgent(MAC_SAFARI_UA);
    defineMaxTouchPoints(0);

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    expect(emitted).toBe(true);
  }));

  it('does not flag macOS Chrome, which does fire the prompt and keeps the real install button', () => {
    defineUserAgent(MAC_CHROME_UA);
    defineMaxTouchPoints(0);

    expect(TestBed.inject(PwaInstallService).isMacSafari).toBe(false);
  });

  it('does not flag iPadOS in desktop mode, already handled as an iOS platform', () => {
    defineUserAgent(MAC_SAFARI_UA);
    defineMaxTouchPoints(5);

    expect(TestBed.inject(PwaInstallService).isMacSafari).toBe(false);
  });

  it('does not flag macOS Safari once the app already runs from the Dock', () => {
    defineUserAgent(MAC_SAFARI_UA);
    defineMaxTouchPoints(0);
    defineMatchMedia(true);

    expect(TestBed.inject(PwaInstallService).isMacSafari).toBe(false);
  });
});

describe('PwaInstallService > post-update standalone grace', () => {
  afterEach(() => {
    removeServiceWorker();
    defineUserAgent(DEFAULT_USER_AGENT);
    defineMatchMedia(false);
    sessionStorage.removeItem(POST_UPDATE_STANDALONE_GRACE_KEY);
    TestBed.resetTestingModule();
  });

  it('markPreUpdateReload persists the marker when the session is standalone', () => {
    removeServiceWorker();
    defineMatchMedia(true);

    TestBed.inject(PwaInstallService).markPreUpdateReload();

    expect(sessionStorage.getItem(POST_UPDATE_STANDALONE_GRACE_KEY)).toBe('true');
  });

  it('markPreUpdateReload does not persist the marker when the session is not standalone', () => {
    removeServiceWorker();
    defineMatchMedia(false);

    TestBed.inject(PwaInstallService).markPreUpdateReload();

    expect(sessionStorage.getItem(POST_UPDATE_STANDALONE_GRACE_KEY)).toBeNull();
  });

  it('resolves installDecision$ to false when the marker is present, even if display-mode misreads non-standalone', fakeAsync(() => {
    removeServiceWorker();
    defineMatchMedia(false);
    sessionStorage.setItem(POST_UPDATE_STANDALONE_GRACE_KEY, 'true');

    const service = TestBed.inject(PwaInstallService);
    let emitted: boolean | undefined;
    service.installDecision$.subscribe((v) => (emitted = v));

    expect(emitted).toBe(false);
  }));

  it('consumes the marker on read, so a later reload in the same tab is not permanently exempted', () => {
    removeServiceWorker();
    defineMatchMedia(false);
    sessionStorage.setItem(POST_UPDATE_STANDALONE_GRACE_KEY, 'true');

    TestBed.inject(PwaInstallService);

    expect(sessionStorage.getItem(POST_UPDATE_STANDALONE_GRACE_KEY)).toBeNull();
  });
});
