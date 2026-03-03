import { inject, Injectable } from '@angular/core';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { JwtService } from './jwt.service';

export interface DpopProof {
  jwt: string;
  publicKeyJwk: JsonWebKey;
}

@Injectable({ providedIn: 'root' })
export class DpopService {
  private readonly keyStorageProvider = inject(KeyStorageProvider);
  private readonly jwtService = inject(JwtService);

  private dpopKeyId: string | null = null;
  private dpopPublicKeyJwk: JsonWebKey | null = null;

  async generateProof(httpMethod: string, httpUri: string): Promise<DpopProof> {
    if (!this.dpopKeyId || !this.dpopPublicKeyJwk) {
      await this.initDpopKey();
    }

    const header = {
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: this.dpopPublicKeyJwk!,
    };

    const payload = {
      jti: globalThis.crypto.randomUUID(),
      htm: httpMethod,
      htu: httpUri,
      iat: Math.floor(Date.now() / 1000),
    };

    const signingInput = this.buildSigningInput(header, payload);
    const signature = await this.keyStorageProvider.sign(
      this.dpopKeyId!,
      new TextEncoder().encode(signingInput)
    );

    return {
      jwt: `${signingInput}.${this.jwtService.base64UrlEncode(signature)}`,
      publicKeyJwk: this.dpopPublicKeyJwk!,
    };
  }

  reset(): void {
    this.dpopKeyId = null;
    this.dpopPublicKeyJwk = null;
  }

  private async initDpopKey(): Promise<void> {
    const keyId = globalThis.crypto.randomUUID();
    const keyInfo = await this.keyStorageProvider.generateKeyPair('ES256', keyId);
    this.dpopKeyId = keyId;
    this.dpopPublicKeyJwk = keyInfo.publicKeyJwk;
  }

  private buildSigningInput(header: unknown, payload: unknown): string {
    const enc = new TextEncoder();
    const headerB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const payloadB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(payload)));
    return `${headerB64}.${payloadB64}`;
  }
}
