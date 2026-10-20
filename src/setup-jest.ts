import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';

setupZoneTestEnv();

// Polyfill crypto.randomUUID for Jest/jsdom environment (not available by default)
// Node's own implementation: no Math.random() and no hand-made UUIDs.
const { randomUUID } = jest.requireActual<{ randomUUID: () => `${string}-${string}-${string}-${string}-${string}` }>('node:crypto');

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: {}, writable: true });
}
if (!globalThis.crypto.randomUUID) {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    value: randomUUID,
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