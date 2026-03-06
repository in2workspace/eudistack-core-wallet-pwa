import { inject, Injectable } from '@angular/core';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { JwtService } from './jwt.service';
import { environment } from 'src/environments/environment';
import { Oid4vciError } from '../../models/error/Oid4vciError';

export interface ClientAttestationHeaders {
  wia: string;
  pop: string;
}

@Injectable({ providedIn: 'root' })
export class WiaService {
  private readonly keyStorageProvider = inject(KeyStorageProvider);
  private readonly jwtService = inject(JwtService);

  private popKeyId: string | null = null;
  private popPublicKeyJwk: JsonWebKey | null = null;

  async fetchAttestationHeaders(audience: string): Promise<ClientAttestationHeaders> {
    const wia = this.getStaticWia();

    if (!this.popKeyId || !this.popPublicKeyJwk) {
      await this.initPopKey(wia);
    }

    const pop = await this.buildPopJwt(audience);

    return { wia, pop };
  }

  reset(): void {
    this.popKeyId = null;
    this.popPublicKeyJwk = null;
  }

  private getStaticWia(): string {
    const wia = (environment as Record<string, unknown>)['wia'] as string | undefined;
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

    if (cnfJwk) {
      const keyId = globalThis.crypto.randomUUID();
      const keyInfo = await this.keyStorageProvider.generateKeyPair('ES256', keyId);
      this.popKeyId = keyId;
      this.popPublicKeyJwk = keyInfo.publicKeyJwk;
    } else {
      throw new Oid4vciError('WIA missing cnf.jwk claim', {
        translationKey: 'errors.wia-invalid',
      });
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

    const signature = await this.keyStorageProvider.sign(
      this.popKeyId!,
      new TextEncoder().encode(signingInput)
    );

    return `${signingInput}.${this.jwtService.base64UrlEncode(signature)}`;
  }
}
