import { TestBed } from '@angular/core/testing';
import { IosInstallService } from './ios-install.service';

const SESSION_KEY = 'ios_onboarding_dismissed';

// setup-jest.ts already defines window.matchMedia as writable:true (no configurable).
// We assign directly instead of redefining.
function setStandaloneMedia(value: boolean): void {
  (window as any).matchMedia = (query: string) => ({
    matches: value && query.includes('standalone'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

function setUA(ua: string): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
}

function setMaxTouchPoints(n: number): void {
  Object.defineProperty(navigator, 'maxTouchPoints', { value: n, configurable: true });
}

function setNavigatorStandalone(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'standalone', { value, configurable: true });
}

describe('IosInstallService', () => {
  let service: IosInstallService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(IosInstallService);
    sessionStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    setMaxTouchPoints(0);
    setNavigatorStandalone(undefined);
    setStandaloneMedia(false);
  });

  // --- AC-008.1: iOS Safari detection ---

  it('detects iPhone Safari in browser mode', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(true);
  });

  it('detects iPad Safari in browser mode', () => {
    setUA('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(true);
  });

  it('detects iPadOS in desktop mode (Macintosh + maxTouchPoints > 1)', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15');
    setMaxTouchPoints(5);
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(true);
  });

  it('returns false for macOS Safari (maxTouchPoints = 0)', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15');
    setMaxTouchPoints(0);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false for Chrome on iOS (CriOS) — AC-008.6', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false for Firefox on iOS (FxiOS) — AC-008.6', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false for Edge on iOS (EdgiOS) — AC-008.6', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false for Android Chrome — AC-008.6', () => {
    setUA('Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36');
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false when navigator.standalone is true — AC-008.5', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(true);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  it('returns false when display-mode is standalone — AC-008.5', () => {
    setUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    setNavigatorStandalone(false);
    setStandaloneMedia(true);
    expect(service.isIosSafariBrowserMode()).toBe(false);
  });

  // --- Dismiss state (AC-008.7) ---

  it('isDismissed returns false when sessionStorage is empty', () => {
    expect(service.isDismissed()).toBe(false);
  });

  it('isDismissed returns true after dismissOnboarding()', () => {
    service.dismissOnboarding();
    expect(service.isDismissed()).toBe(true);
  });

  it('dismissOnboarding writes to sessionStorage, not localStorage', () => {
    service.dismissOnboarding();
    expect(sessionStorage.getItem(SESSION_KEY)).toBe('true');
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  // --- Wizard state ---

  it('wizardState returns not-bootstrapped when no passkey', () => {
    expect(service.wizardState(false)).toBe('not-bootstrapped');
  });

  it('wizardState returns already-bootstrapped when passkey exists', () => {
    expect(service.wizardState(true)).toBe('already-bootstrapped');
  });
});
