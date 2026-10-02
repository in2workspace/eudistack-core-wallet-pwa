import { getBrowserName } from './browser-detect.util';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15';
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0';
const OPERA_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0';
const CHROME_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15';

describe('getBrowserName', () => {
  it('detects Edge even though its UA also contains Chrome and Safari tokens', () => {
    expect(getBrowserName(EDGE_WINDOWS)).toBe('Edge');
  });

  it('detects Opera even though its UA also contains Chrome and Safari tokens', () => {
    expect(getBrowserName(OPERA_WINDOWS)).toBe('Opera');
  });

  it('detects Chrome on desktop', () => {
    expect(getBrowserName(CHROME_WINDOWS)).toBe('Chrome');
  });

  it('detects Chrome on iOS (CriOS)', () => {
    expect(getBrowserName(CHROME_IOS)).toBe('Chrome');
  });

  it('detects Firefox on desktop', () => {
    expect(getBrowserName(FIREFOX_WINDOWS)).toBe('Firefox');
  });

  it('detects Firefox on iOS (FxiOS)', () => {
    expect(getBrowserName(FIREFOX_IOS)).toBe('Firefox');
  });

  it('detects Safari, checked last since Chrome/Edge/Opera UAs all also contain it', () => {
    expect(getBrowserName(SAFARI_MAC)).toBe('Safari');
  });

  it('returns null for an unrecognized user agent', () => {
    expect(getBrowserName('SomeUnknownBot/1.0')).toBeNull();
  });

  it('returns null for empty or missing input', () => {
    expect(getBrowserName('')).toBeNull();
    expect(getBrowserName(null)).toBeNull();
    expect(getBrowserName(undefined)).toBeNull();
  });
});
