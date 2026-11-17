import dayjs from 'dayjs';
import { hasExpired } from './credential-expiry.util';

describe('hasExpired', () => {
  it('is true for a date in the past', () => {
    expect(hasExpired('2020-01-01T00:00:00.000Z')).toBe(true);
  });

  it('is false for a date in the future', () => {
    expect(hasExpired('2099-01-01T00:00:00.000Z')).toBe(false);
  });

  it('is false when there is no expiry date', () => {
    expect(hasExpired(undefined)).toBe(false);
    expect(hasExpired('')).toBe(false);
  });

  it('is false for a date that cannot be parsed', () => {
    expect(hasExpired('not-a-date')).toBe(false);
  });

  it('compares against the moment given', () => {
    const expiry = '2026-06-01T00:00:00.000Z';

    expect(hasExpired(expiry, dayjs('2026-05-31T00:00:00.000Z'))).toBe(false);
    expect(hasExpired(expiry, dayjs('2026-06-02T00:00:00.000Z'))).toBe(true);
  });
});
