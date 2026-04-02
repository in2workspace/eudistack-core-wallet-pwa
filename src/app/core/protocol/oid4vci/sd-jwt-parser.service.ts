import { inject, Injectable } from '@angular/core';
import { JwtService } from './jwt.service';

export interface SdJwtParts {
  issuerJwt: string;
  disclosures: string[];
}

export interface DecodedDisclosure {
  salt: string;
  claimName: string;
  claimValue: unknown;
  encoded: string;
}

export interface ReconstructedSdJwt {
  payload: Record<string, unknown>;
  issuerJwt: string;
}

/**
 * SD-JWT parser compliant with RFC 9901.
 *
 * Resolution algorithm:
 * 1. Split compact SD-JWT into issuer JWT + disclosures
 * 2. For each disclosure, compute digest = base64url(SHA-256(disclosure_encoded))
 * 3. Walk the JWT payload recursively; for each object containing _sd:
 *    - Match digests in _sd against computed disclosure digests
 *    - Replace matched digests with the disclosed claim (name -> value)
 * 4. Recursively process disclosed values (they may contain nested _sd)
 */
@Injectable({ providedIn: 'root' })
export class SdJwtParserService {

  private readonly jwtService = inject(JwtService);

  isSdJwt(credential: string): boolean {
    return credential.includes('~');
  }

  split(compact: string): SdJwtParts {
    const segments = compact.split('~');
    const issuerJwt = segments[0];
    const disclosures = segments.slice(1).filter(s => s.length > 0);
    return { issuerJwt, disclosures };
  }

  decodeDisclosure(encoded: string): DecodedDisclosure {
    const bytes = this.jwtService.base64UrlDecodeToBytes(encoded);
    const json = new TextDecoder().decode(bytes);
    const arr = JSON.parse(json);

    if (!Array.isArray(arr) || arr.length < 2 || arr.length > 3) {
      throw new Error(`Invalid disclosure: expected [salt, name, value] or [salt, value], got ${json}`);
    }

    if (arr.length === 3) {
      return { salt: arr[0], claimName: arr[1], claimValue: arr[2], encoded };
    }
    return { salt: arr[0], claimName: '', claimValue: arr[1], encoded };
  }

  /**
   * Reconstructs the full payload from an SD-JWT compact string per RFC 9901.
   * Supports _sd at any nesting depth with digest-based matching.
   */
  reconstructClaims(compact: string): ReconstructedSdJwt {
    const { issuerJwt, disclosures } = this.split(compact);
    const payload = JSON.parse(JSON.stringify(
      this.jwtService.extractJwtPayload(issuerJwt) as Record<string, unknown>
    ));

    // Build digest -> disclosure map
    const digestMap = new Map<string, DecodedDisclosure>();
    for (const encoded of disclosures) {
      const decoded = this.decodeDisclosure(encoded);
      const digest = this.computeDigest(encoded);
      digestMap.set(digest, decoded);
    }

    // Recursively resolve _sd arrays by digest matching
    this.resolveObject(payload, digestMap);

    return { payload, issuerJwt };
  }

  private resolveObject(obj: Record<string, unknown>, digestMap: Map<string, DecodedDisclosure>): void {
    const sdArray = obj['_sd'];
    if (Array.isArray(sdArray)) {
      for (const digest of sdArray) {
        if (typeof digest === 'string' && digestMap.has(digest)) {
          const disclosure = digestMap.get(digest)!;
          obj[disclosure.claimName] = disclosure.claimValue;
        }
      }
      delete obj['_sd'];
      delete obj['_sd_alg'];
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this.resolveObject(value as Record<string, unknown>, digestMap);
      }
      if (Array.isArray(value)) {
        this.resolveArray(value, digestMap);
      }
    }
  }

  private resolveArray(arr: unknown[], digestMap: Map<string, DecodedDisclosure>): void {
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        if ('...' in obj && typeof obj['...'] === 'string') {
          const digest = obj['...'] as string;
          if (digestMap.has(digest)) {
            arr[i] = digestMap.get(digest)!.claimValue;
          }
        } else {
          this.resolveObject(obj, digestMap);
        }
      }
    }
  }

  /**
   * Computes base64url(SHA-256(ASCII_bytes_of_disclosure)) synchronously.
   * Uses a pure JS SHA-256 implementation to avoid async crypto.subtle.
   */
  private computeDigest(encodedDisclosure: string): string {
    const data = new TextEncoder().encode(encodedDisclosure);
    const hash = sha256(data);
    return base64UrlEncode(hash);
  }
}

// ── Pure JS SHA-256 (RFC 6234) ─────────────────────────────────────────────

const K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLen = msgLen * 8;

  // Pre-processing: padding
  const padLen = (((msgLen + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(message);
  padded[msgLen] = 0x80;

  // Append length as 64-bit big-endian
  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen, false);

  const w = new Int32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7)) ^ (rotr(w[i - 15], 18)) ^ (w[i - 15] >>> 3);
      const s1 = (rotr(w[i - 2], 17)) ^ (rotr(w[i - 2], 19)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false);
  rv.setUint32(8, h2, false); rv.setUint32(12, h3, false);
  rv.setUint32(16, h4, false); rv.setUint32(20, h5, false);
  rv.setUint32(24, h6, false); rv.setUint32(28, h7, false);
  return result;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
