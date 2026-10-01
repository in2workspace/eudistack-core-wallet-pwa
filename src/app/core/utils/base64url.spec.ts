import { base64UrlDecode, base64UrlEncode, compareCredentialIds } from './base64url';

describe('base64url', () => {
  describe('base64UrlEncode / base64UrlDecode', () => {
    it('round-trips bytes that produce "+", "/" and padding in standard base64', () => {
      const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x01]);

      const encoded = base64UrlEncode(bytes);

      expect(encoded).toBe('-_-_AQ');
      expect(Array.from(base64UrlDecode(encoded))).toEqual(Array.from(bytes));
    });
  });

  describe('compareCredentialIds', () => {
    it('treats the base64url and padded base64 forms of the same id as equal', () => {
      expect(compareCredentialIds('-_-_AQ', '+/+/AQ==')).toBe(true);
    });

    it('returns false for different ids', () => {
      expect(compareCredentialIds('-_-_AQ', '-_-_AA')).toBe(false);
    });

    it('returns false when only one id is present', () => {
      expect(compareCredentialIds('-_-_AQ', null)).toBe(false);
      expect(compareCredentialIds(undefined, '-_-_AQ')).toBe(false);
    });

    it('returns true when both ids are identical, including both missing', () => {
      expect(compareCredentialIds('abc', 'abc')).toBe(true);
      expect(compareCredentialIds(null, null)).toBe(true);
    });
  });
});
