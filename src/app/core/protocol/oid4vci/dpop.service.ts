import { inject, Injectable } from '@angular/core';
import { PasskeyPrfKeyStorageProvider } from '../../spi-impl/passkey-prf-key-storage.service';
import { JwtService } from './jwt.service';

export interface DpopProof {
  jwt: string;
  publicKeyJwk: JsonWebKey;
}

@Injectable({ providedIn: 'root' })
export class DpopService {
  // DPoP keys are session-ephemeral and must always be generated client-side,
  // regardless of wallet_mode. Injecting PasskeyPrfKeyStorageProvider directly
  // bypasses the server-mode factory and uses the local ephemeral key path.
  private readonly keyStorageProvider = inject(PasskeyPrfKeyStorageProvider);
  private readonly jwtService = inject(JwtService);

  private dpopKeyId: string | null = null;
  private dpopPublicKeyJwk: JsonWebKey | null = null;

  async issueProof(httpMethod: string, httpUri: string, accessToken?: string): Promise<DpopProof> {
    if (!this.dpopKeyId || !this.dpopPublicKeyJwk) {
      await this.initDpopKey();
    }

    const header = {
      typ: 'dpop+jwt',
      alg: 'ES256',
      jwk: this.dpopPublicKeyJwk!,
    };

    const payload: Record<string, unknown> = {
      jti: globalThis.crypto.randomUUID(),
      htm: httpMethod,
      htu: httpUri,
      iat: Math.floor(Date.now() / 1000),
    };

    // RFC 9449 §4.2/§4.3: DPoP proofs presented alongside an access token
    // (resource-server calls, e.g. /credential) MUST include "ath" - the
    // access token hash. Proofs for PAR/token requests have no access token
    // yet, so accessToken is left undefined there and "ath" is omitted.
    if (accessToken) {
      payload['ath'] = await this.computeAth(accessToken);
    }

    const signingInput = this.composeSigningInput(header, payload);
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

  private async computeAth(accessToken: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(accessToken)
    );
    return this.jwtService.base64UrlEncode(new Uint8Array(digest));
  }

  private composeSigningInput(header: unknown, payload: unknown): string {
    const enc = new TextEncoder();
    const headerB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(header)));
    const payloadB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(payload)));
    return `${headerB64}.${payloadB64}`;
  }
}
