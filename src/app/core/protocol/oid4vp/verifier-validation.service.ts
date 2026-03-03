import { inject, Injectable } from '@angular/core';
import { compactVerify, importX509 } from 'jose';
import { JwtService } from '../oid4vci/jwt.service';
import { didKeyToCryptoKey } from '../../utils/did-key.utils';

@Injectable({
  providedIn: 'root'
})
export class VerifierValidationService {

  private readonly jwtService = inject(JwtService);

  async verifyAuthorizationRequest(jwt: string): Promise<string> {
    this.validateHeaderTyp(jwt);
    this.validateClientIdMatchesIss(jwt);
    await this.verifySignature(jwt);
    return jwt;
  }

  private validateHeaderTyp(jwt: string): void {
    const header = this.jwtService.parseJwtHeader(jwt) as Record<string, unknown>;
    const typ = header['typ'];
    if (typ !== 'oauth-authz-req+jwt') {
      throw new Error(`Invalid or missing 'typ' claim in Authorization Request. Expected: oauth-authz-req+jwt, got: ${typ}`);
    }
  }

  private validateClientIdMatchesIss(jwt: string): void {
    const payload = this.jwtService.parseJwtPayload(jwt) as Record<string, unknown>;
    const iss = payload['iss'] as string | undefined;
    const clientId = payload['client_id'] as string | undefined;

    if (!clientId) {
      throw new Error('client_id not found in authorization request');
    }
    if (!iss) {
      throw new Error('iss not found in authorization request');
    }
    if (clientId !== iss) {
      throw new Error('iss and client_id MUST match in the Authorization Request');
    }
  }

  private async verifySignature(jwt: string): Promise<void> {
    const header = this.jwtService.parseJwtHeader(jwt) as Record<string, unknown>;
    const payload = this.jwtService.parseJwtPayload(jwt) as Record<string, unknown>;
    const x5c = header['x5c'] as string[] | undefined;
    const clientIdScheme = payload['client_id_scheme'] as string | undefined;

    if (x5c && x5c.length > 0) {
      await this.verifyWithX5c(jwt, x5c, payload);
    } else {
      await this.verifyWithDidKey(jwt, header);
    }
  }

  private async verifyWithX5c(
    jwt: string,
    x5c: string[],
    payload: Record<string, unknown>
  ): Promise<void> {
    const leafCertBase64 = x5c[0];
    const pem = `-----BEGIN CERTIFICATE-----\n${leafCertBase64}\n-----END CERTIFICATE-----`;
    const publicKey = await importX509(pem, 'ES256');

    await compactVerify(jwt, publicKey);

    // If client_id_scheme is x509_hash, validate that the hash matches the leaf cert
    const clientIdScheme = payload['client_id_scheme'] as string | undefined;
    const clientId = payload['client_id'] as string | undefined;

    if (clientIdScheme === 'x509_hash' && clientId) {
      await this.validateX509Hash(leafCertBase64, clientId);
    }
  }

  private async validateX509Hash(leafCertBase64: string, clientId: string): Promise<void> {
    const prefix = 'x509_hash:';
    if (!clientId.startsWith(prefix)) {
      throw new Error(`client_id does not have x509_hash prefix: ${clientId}`);
    }

    const expectedHash = clientId.substring(prefix.length);
    const certDer = Uint8Array.from(atob(leafCertBase64), c => c.charCodeAt(0));
    const hashBuffer = await crypto.subtle.digest('SHA-256', certDer);
    const hashBytes = new Uint8Array(hashBuffer);

    // Base64url encode (no padding)
    const actualHash = btoa(String.fromCharCode(...hashBytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    if (actualHash !== expectedHash) {
      throw new Error(`x509_hash mismatch: client_id hash=${expectedHash}, computed=${actualHash}`);
    }
  }

  private async verifyWithDidKey(jwt: string, header: Record<string, unknown>): Promise<void> {
    const kid = header['kid'] as string | undefined;

    if (!kid) {
      throw new Error('Neither x5c nor kid found in JWT header');
    }

    const publicKey = await didKeyToCryptoKey(kid);
    await compactVerify(jwt, publicKey);
  }
}
