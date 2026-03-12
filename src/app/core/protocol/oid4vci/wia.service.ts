import { inject, Injectable } from '@angular/core';
import { JwtService } from './jwt.service';
import { environment } from 'src/environments/environment';
import { Oid4vciError } from '../../models/error/Oid4vciError';

export interface ClientAttestationHeaders {
  wia: string;
  pop: string;
}

@Injectable({ providedIn: 'root' })
export class WiaService {
  private readonly jwtService = inject(JwtService);

  private popPrivateKey: CryptoKey | null = null;
  private popPublicKeyJwk: JsonWebKey | null = null;

  async fetchAttestationHeaders(audience: string): Promise<ClientAttestationHeaders> {
    const wia = this.getStaticWia();

    if (!this.popPrivateKey || !this.popPublicKeyJwk) {
      await this.initPopKey(wia);
    }

    const pop = await this.buildPopJwt(audience);

    return { wia, pop };
  }

  reset(): void {
    this.popPrivateKey = null;
    this.popPublicKeyJwk = null;
  }

  private getStaticWia(): string {
    const wia = environment.wia;
    if (!wia) {
      throw new Oid4vciError('WIA not configured in environment', {
        translationKey: 'errors.wia-not-configured',
      });
    }
    return wia;
  }

  private async initPopKey(wia: string): Promise<void> {
    const wiaPayload = this.jwtService.extractJwtPayload(wia) as Record<string, unknown>;
    const cnf = wiaPayload['cnf'] as Record<string, unknown> | undefined;
    const cnfJwk = cnf?.['jwk'] as JsonWebKey | undefined;

    if (!cnfJwk) {
      throw new Oid4vciError('WIA missing cnf.jwk claim', {
        translationKey: 'errors.wia-invalid',
      });
    }

    // If the environment provides the matching private key, import it.
    // Otherwise generate a new key (will fail server-side PoP verification in dev).
    const instanceKeyJson = environment.wia_instance_key_jwk;
    if (instanceKeyJson) {
      const privateJwk: JsonWebKey = JSON.parse(instanceKeyJson);
      this.popPrivateKey = await globalThis.crypto.subtle.importKey(
        'jwk',
        privateJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
      );
      // Use the public part from the WIA cnf (authoritative source)
      this.popPublicKeyJwk = cnfJwk;
    } else {
      console.warn('[WiaService] wia_instance_key_jwk not configured — generating ephemeral key (PoP verification will fail)');
      const keyPair = await globalThis.crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign', 'verify']
      );
      this.popPrivateKey = keyPair.privateKey;
      this.popPublicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    }
  }

  private async buildPopJwt(audience: string): Promise<string> {
    const header = {
      typ: 'jwt',
      alg: 'ES256',
      jwk: this.popPublicKeyJwk!,
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: (this.jwtService.extractJwtPayload(this.getStaticWia()) as Record<string, unknown>)['sub'],
      aud: audience,
      iat: now,
      exp: now + 300,
      jti: globalThis.crypto.randomUUID(),
    };

    const enc = new TextEncoder();
    const headerB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const payloadB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(payload)));
    const signingInput = `${headerB64}.${payloadB64}`;

    const signature = await globalThis.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      this.popPrivateKey!,
      new TextEncoder().encode(signingInput)
    );

    return `${signingInput}.${this.jwtService.base64UrlEncode(new Uint8Array(signature))}`;
  }
}