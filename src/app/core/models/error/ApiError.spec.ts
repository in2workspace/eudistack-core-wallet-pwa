import { parseApiError } from './ApiError';

const EXPIRED_PROBLEM = {
  type: 'credential_offer_expired',
  title: 'Credential offer expired',
  status: 410,
  detail: 'The credential offer has expired.',
  instance: 'aa7ead92-35f7-4c24-af44-678d35dd38c0',
};

describe('parseApiError', () => {
  it('parses a Problem Details object', () => {
    expect(parseApiError(EXPIRED_PROBLEM)).toEqual(EXPIRED_PROBLEM);
  });

  it('parses a Problem Details JSON string (responseType: text)', () => {
    expect(parseApiError(JSON.stringify(EXPIRED_PROBLEM))).toEqual(EXPIRED_PROBLEM);
  });

  it('keeps a body that only carries a type, leaving the rest undefined', () => {
    expect(parseApiError({ type: 'credential_offer_expired' })).toEqual({
      type: 'credential_offer_expired',
      title: undefined,
      status: undefined,
      detail: undefined,
      instance: undefined,
    });
  });

  it('drops fields with the wrong type instead of trusting them', () => {
    const parsed = parseApiError({ type: 'x', title: 42, status: '410', detail: {}, instance: [] });

    expect(parsed).toEqual({ type: 'x', title: undefined, status: undefined, detail: undefined, instance: undefined });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
    ['non-JSON text', '<html>Bad Gateway</html>'],
    ['a JSON primitive', '"oops"'],
    ['an object without type', { title: 'Credential offer expired', status: 410 }],
    ['a non-string type', { type: 410 }],
    ['a blank type', { type: '   ' }],
    ['a ProgressEvent-like network error body', { isTrusted: true }],
  ])('returns null for %s', (_label, body) => {
    expect(parseApiError(body)).toBeNull();
  });
});