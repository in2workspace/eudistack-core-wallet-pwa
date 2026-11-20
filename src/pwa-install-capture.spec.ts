declare const require: (path: string) => unknown;

// The script is a global script of angular.json (not an ES module): load a fresh copy per test,
// so it runs again against the current window as the browser would run it once per page.
const runScript = (): void => {
  jest.isolateModules(() => {
    require('./pwa-install-capture.js');
  });
};

describe('pwa-install-capture.js', () => {
  afterEach(() => {
    delete (window as any).__pwaInstallPrompt;
  });

  it('starts with no captured prompt', () => {
    (window as any).__pwaInstallPrompt = 'stale';

    runScript();

    expect((window as any).__pwaInstallPrompt).toBeNull();
  });

  it('captures beforeinstallprompt and prevents the browser mini-infobar', () => {
    runScript();
    const event = new Event('beforeinstallprompt', { cancelable: true });

    window.dispatchEvent(event);

    expect((window as any).__pwaInstallPrompt).toBe(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
