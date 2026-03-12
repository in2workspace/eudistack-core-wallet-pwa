const DID_KEY_PREFIX = 'did:key:z';
const MULTICODEC_P256 = 0x1200;

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Decode(input: string): Uint8Array {
  const alphabetMap = new Map<string, number>();
  for (let i = 0; i < BASE58_ALPHABET.length; i++) {
    alphabetMap.set(BASE58_ALPHABET[i], i);
  }

  let result = [0];
  for (const char of input) {
    const value = alphabetMap.get(char);
    if (value === undefined) {
      throw new Error(`Invalid Base58 character: ${char}`);
    }
    let carry = value;
    for (let j = 0; j < result.length; j++) {
      carry += result[j] * 58;
      result[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      result.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Leading zeros in Base58 map to leading zero bytes
  for (const char of input) {
    if (char !== '1') break;
    result.push(0);
  }

  return new Uint8Array(result.reverse());
}

export function uvarintLength(value: number): number {
  let length = 0;
  let rest = value;
  do {
    rest = rest >>> 7;
    length++;
  } while (rest !== 0);
  return length;
}

function stripMulticodecPrefix(bytes: Uint8Array, expectedCode: number): Uint8Array {
  const prefixLength = uvarintLength(expectedCode);
  return bytes.slice(prefixLength);
}

function decompressP256Point(compressed: Uint8Array): Uint8Array {
  if (compressed.length !== 33 || (compressed[0] !== 0x02 && compressed[0] !== 0x03)) {
    throw new Error('Invalid compressed P-256 point');
  }

  const p = BigInt('0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF');
  const a = p - 3n;
  const b = BigInt('0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B');

  const x = bytesToBigInt(compressed.slice(1));
  const ySquared = ((modPow(x, 3n, p) + ((a * x) % p) + b) % p + p) % p;
  let y = modSqrt(ySquared, p);

  const isOdd = compressed[0] === 0x03;
  if ((y % 2n === 1n) !== isOdd) {
    y = p - y;
  }

  const uncompressed = new Uint8Array(65);
  uncompressed[0] = 0x04;
  bigIntToBytes(x, uncompressed, 1, 32);
  bigIntToBytes(y, uncompressed, 33, 32);
  return uncompressed;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    result = (result << BigInt(8)) | BigInt(bytes[i]);
  }
  return result;
}

function bigIntToBytes(value: bigint, target: Uint8Array, offset: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) {
    target[offset + i] = Number(value & 0xffn);
    value >>= 8n;
  }
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

function modSqrt(a: bigint, p: bigint): bigint {
  // P-256 prime is ≡ 3 (mod 4), so sqrt = a^((p+1)/4) mod p
  return modPow(a, (p + 1n) / 4n, p);
}

export async function didKeyToJwk(didKey: string): Promise<JsonWebKey> {
  if (!didKey.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`Invalid DID Key format: expected prefix '${DID_KEY_PREFIX}'`);
  }

  const encodedMultiBase58 = didKey.substring(DID_KEY_PREFIX.length);
  const multiCodecAndKey = base58Decode(encodedMultiBase58);
  const compressedPublicKey = stripMulticodecPrefix(multiCodecAndKey, MULTICODEC_P256);
  const uncompressedPoint = decompressP256Point(compressedPublicKey);

  // Extract x and y coordinates (skip 0x04 prefix)
  const x = uncompressedPoint.slice(1, 33);
  const y = uncompressedPoint.slice(33, 65);

  return {
    kty: 'EC',
    crv: 'P-256',
    x: uint8ArrayToBase64Url(x),
    y: uint8ArrayToBase64Url(y),
  };
}

export async function didKeyToCryptoKey(didKey: string): Promise<CryptoKey> {
  const jwk = await didKeyToJwk(didKey);
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
