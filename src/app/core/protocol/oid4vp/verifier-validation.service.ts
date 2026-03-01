import { inject, Injectable } from '@angular/core';
import { compactVerify } from 'jose';
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
    const kid = header['kid'] as string | undefined;

    if (!kid) {
      throw new Error('kid not found in JWT header');
    }

    const publicKey = await didKeyToCryptoKey(kid);
    const jwtBytes = new TextEncoder().encode(jwt);
    await compactVerify(jwt, publicKey);
  }
}
