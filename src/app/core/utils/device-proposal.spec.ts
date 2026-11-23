import { DeviceEnvironment, deviceName, isValidDeviceName, proposeDevice } from './device-proposal';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
};

function env(userAgent: string, overrides: Partial<DeviceEnvironment> = {}): DeviceEnvironment {
  return { userAgent, maxTouchPoints: 0, standalone: false, ...overrides };
}

describe('proposeDevice (EUD-15 FR-04)', () => {
  it.each([
    [UA.iphoneSafari, 0, 'mobile', 'iPhone · Safari'],
    [UA.ipadDesktopSafari, 5, 'tablet', 'iPad · Safari'],
    [UA.androidChrome, 0, 'mobile', 'Android · Chrome'],
    [UA.androidTablet, 0, 'tablet', 'Android · Chrome'],
    [UA.windowsEdge, 0, 'desktop', 'Windows · Edge'],
    [UA.macChrome, 0, 'desktop', 'Mac · Chrome'],
    [UA.linuxFirefox, 0, 'desktop', 'Linux · Firefox'],
    [UA.samsung, 0, 'mobile', 'Android · Samsung Internet'],
  ])('proposes the type and the name of %s', (userAgent, touchPoints, type, name) => {
    const proposal = proposeDevice(env(userAgent, { maxTouchPoints: touchPoints as number }));

    expect(proposal.type).toBe(type);
    expect(deviceName(proposal, 'App instalada')).toBe(name);
  });

  it('names the installed app instead of the browser', () => {
    const proposal = proposeDevice(env(UA.iphoneSafari, { standalone: true }));

    expect(deviceName(proposal, 'App instalada')).toBe('iPhone · App instalada');
  });

  it('prefers userAgentData when the browser has it', () => {
    const proposal = proposeDevice(env('Mozilla/5.0', {
      userAgentData: { mobile: false, platform: 'Windows', brands: [{ brand: 'Microsoft Edge', version: '130' }] },
    }));

    expect(proposal.type).toBe('desktop');
    expect(deviceName(proposal, 'App instalada')).toBe('Windows · Edge');
  });
});

describe('isValidDeviceName (FR-04, FR-12)', () => {
  it.each([
    ['iPhone · Safari', true],
    ['a'.repeat(50), true],
    ['a'.repeat(51), false],
    ['', false],
    ['   ', false],
  ])('%s is valid: %s', (name, valid) => {
    expect(isValidDeviceName(name)).toBe(valid);
  });
});
