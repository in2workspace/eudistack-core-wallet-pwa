import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// Polyfill crypto.randomUUID for Jest/jsdom environment (not available by default)
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: {}, writable: true });
}
if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: () => {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      }) as `${string}-${string}-${string}-${string}-${string}`;
    },
    configurable: true,
    writable: true,
  });
}

// JSDOM does not implement window.matchMedia; mock it so PwaInstallService
// (and any component that injects it) can instantiate in tests.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});