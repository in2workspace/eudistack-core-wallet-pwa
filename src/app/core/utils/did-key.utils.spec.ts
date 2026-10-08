import { base58Decode, didKeyToCryptoKey, didKeyToJwk, uvarintLength } from './did-key.utils';

const DID_EVEN_Y = 'did:key:zDnaea1YYsBzZWoeVithwzqjHjCSSJXg7QBULsYdoNtQoFu8E';
const DID_EVEN_Y_X = 'jlM7b6C_e0YluzBmfAH7YH75-LioD-9bMAYocDGHsqM';
const DID_EVEN_Y_Y = 'c-sdveAzGDZtBp-DpvWQAFPHNjPLBBshxV4ahsH0ALQ';

const DID_ODD_Y = 'did:key:zDnaepsL7AXenJkVYdkh5KuKsSU7Ykh7kyXaLLU7auN9FWSiZ';
const DID_ODD_Y_X = 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY';
const DID_ODD_Y_Y = 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU';

const DID_POINT_TOO_SHORT = 'did:key:z4GyWZW';
const DID_POINT_BAD_PREFIX = 'did:key:zDnafJKgwFQ533GQCTQJkBS1H9eHhjJPy3EZr314H4wn1wvcq';

describe('did-key.utils', () => {
  describe('base58Decode', () => {
    it('decodes a Base58 string into the original bytes', () => {
      const decoded = base58Decode('2NEpo7TZRRrLZSi2U');

      expect(new TextDecoder().decode(decoded)).toBe('Hello World!');
    });

    it('maps each leading "1" to a leading zero byte', () => {
      expect(Array.from(base58Decode('Z'))).toEqual([32]);
      expect(Array.from(base58Decode('1Z'))).toEqual([0, 32]);
      expect(Array.from(base58Decode('11Z'))).toEqual([0, 0, 32]);
    });

    it('carries across byte boundaries for inputs larger than one byte', () => {
      expect(Array.from(base58Decode('LUv'))).toEqual([255, 255]);
    });

    it('throws naming the offending character when it is outside the alphabet', () => {
      expect(() => base58Decode('abc0def')).toThrow('Invalid Base58 character: 0');
    });

    it('rejects the characters excluded from the Base58 alphabet', () => {
      expect(() => base58Decode('O')).toThrow('Invalid Base58 character: O');
      expect(() => base58Decode('I')).toThrow('Invalid Base58 character: I');
      expect(() => base58Decode('l')).toThrow('Invalid Base58 character: l');
    });
  });

  describe('uvarintLength', () => {
    it('uses a single byte up to 127', () => {
      expect(uvarintLength(0)).toBe(1);
      expect(uvarintLength(1)).toBe(1);
      expect(uvarintLength(127)).toBe(1);
    });

    it('needs a second byte from 128 onwards', () => {
      expect(uvarintLength(128)).toBe(2);
      expect(uvarintLength(16383)).toBe(2);
    });

    it('needs two bytes for the P-256 multicodec 0x1200', () => {
      expect(uvarintLength(0x1200)).toBe(2);
    });

    it('needs a third byte from 16384 onwards', () => {
      expect(uvarintLength(16384)).toBe(3);
    });
  });

  describe('didKeyToJwk', () => {
    it('decompresses a point with an even y coordinate', async () => {
      await expect(didKeyToJwk(DID_EVEN_Y)).resolves.toEqual({
        kty: 'EC',
        crv: 'P-256',
        x: DID_EVEN_Y_X,
        y: DID_EVEN_Y_Y,
      });
    });

    it('negates the recovered y coordinate when the point is flagged odd', async () => {
      await expect(didKeyToJwk(DID_ODD_Y)).resolves.toEqual({
        kty: 'EC',
        crv: 'P-256',
        x: DID_ODD_Y_X,
        y: DID_ODD_Y_Y,
      });
    });

    it('rejects a DID that does not start with the did:key:z prefix', async () => {
      await expect(didKeyToJwk('did:web:example.com')).rejects.toThrow(
        "Invalid DID Key format: expected prefix 'did:key:z'"
      );
    });

    it('rejects a DID whose multibase payload is not 33 bytes', async () => {
      await expect(didKeyToJwk(DID_POINT_TOO_SHORT)).rejects.toThrow('Invalid compressed P-256 point');
    });

    it('rejects a 33-byte payload whose leading byte is neither 0x02 nor 0x03', async () => {
      await expect(didKeyToJwk(DID_POINT_BAD_PREFIX)).rejects.toThrow('Invalid compressed P-256 point');
    });
  });

  describe('didKeyToCryptoKey', () => {
    const originalCrypto = globalThis.crypto;
    let importKey: jest.Mock;

    beforeEach(() => {
      importKey = jest.fn().mockResolvedValue({ type: 'public' } as CryptoKey);
      Object.defineProperty(globalThis, 'crypto', {
        value: { subtle: { importKey } },
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      });
    });

    it('imports the decoded JWK as a P-256 verify-only key', async () => {
      const key = await didKeyToCryptoKey(DID_EVEN_Y);

      expect(key).toEqual({ type: 'public' });
      expect(importKey).toHaveBeenCalledWith(
        'jwk',
        { kty: 'EC', crv: 'P-256', x: DID_EVEN_Y_X, y: DID_EVEN_Y_Y },
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );
    });

    it('propagates the decoding failure without reaching the WebCrypto import', async () => {
      await expect(didKeyToCryptoKey('did:web:example.com')).rejects.toThrow('Invalid DID Key format');
      expect(importKey).not.toHaveBeenCalled();
    });
  });
});
