import { inject, Injectable } from '@angular/core';
import * as cbor from 'cbor-web';
import * as pako from 'pako';
import { JwtService } from '../oid4vci/jwt.service';

// COSE Sign1 structure tag
const COSE_SIGN1_TAG = 18;

// COSE Algorithm identifier for ES256 (-7)
const COSE_ALG_ES256 = -7;

// COSE header label for Algorithm
const COSE_HEADER_ALG = 1;

// Base45 character set (ISO/IEC 18004:2024)
const BASE45_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

@Injectable({
  providedIn: 'root'
})
export class CborGenerationService {

  private readonly jwtService = inject(JwtService);

  async generateCbor(vpJwt: string): Promise<string> {
    const vpPayload = this.extractVpPayload(vpJwt);
    const cborBytes = cbor.encode(vpPayload);
    const coseBytes = await this.generateCoseSign1(new Uint8Array(cborBytes));
    const compressed = pako.deflate(coseBytes, { level: 9 });
    return this.base45Encode(compressed);
  }

  private extractVpPayload(vpJwt: string): unknown {
    const payload = this.jwtService.extractJwtPayload(vpJwt) as Record<string, unknown>;
    const vp = payload['vp'] as Record<string, unknown> | undefined;

    if (vp && Array.isArray(vp['verifiableCredential']) && vp['verifiableCredential'].length > 0) {
      // Replace the array with just the first credential (string) for compact CBOR
      vp['verifiableCredential'] = vp['verifiableCredential'][0];
    }

    return payload;
  }

  private async generateCoseSign1(cborPayload: Uint8Array): Promise<Uint8Array> {
    // Generate ephemeral P-256 key pair for COSE signing
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    // Build protected header: { 1: -7 } (alg: ES256)
    const protectedHeader = cbor.encode(new Map([[COSE_HEADER_ALG, COSE_ALG_ES256]]));
    const protectedHeaderBytes = new Uint8Array(protectedHeader);

    // Unprotected header: include public key JWK
    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const unprotectedHeader = new Map<number, unknown>();
    // KID header (label 4) — set to a serialized version of the public key for verification
    unprotectedHeader.set(4, new TextEncoder().encode(JSON.stringify(publicKeyJwk)));

    // Build Sig_structure for COSE Sign1: ["Signature1", protectedHeader, externalAad, payload]
    const sigStructure = cbor.encode([
      'Signature1',
      protectedHeaderBytes,
      new Uint8Array(0), // external_aad
      cborPayload,
    ]);

    // Sign with ECDSA P-256
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      keyPair.privateKey,
      sigStructure
    );

    // Build COSE_Sign1 = Tag(18, [protectedHeader, unprotectedHeader, payload, signature])
    const coseSign1 = cbor.encode(
      new cbor.Tagged(COSE_SIGN1_TAG, [
        protectedHeaderBytes,
        unprotectedHeader,
        cborPayload,
        new Uint8Array(signature),
      ])
    );

    return new Uint8Array(coseSign1);
  }

  private base45Encode(data: Uint8Array): string {
    let result = '';

    for (let i = 0; i < data.length; i += 2) {
      if (i + 1 < data.length) {
        // Process pair of bytes
        let value = data[i] * 256 + data[i + 1];
        const c = value % 45;
        value = Math.floor(value / 45);
        const b = value % 45;
        const a = Math.floor(value / 45);
        result += BASE45_CHARSET[c] + BASE45_CHARSET[b] + BASE45_CHARSET[a];
      } else {
        // Process single remaining byte
        const value = data[i];
        const c = value % 45;
        const b = Math.floor(value / 45);
        result += BASE45_CHARSET[c] + BASE45_CHARSET[b];
      }
    }

    return result;
  }
}
