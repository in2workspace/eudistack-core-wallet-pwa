import { inject, Injectable } from '@angular/core';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { SdJwtParserService } from '../protocol/oid4vci/sd-jwt-parser.service';
import { VerifiableCredential, LifeCycleStatus, Issuer, CredentialSubject, CredentialStatus, ExtendedCredentialType } from '../models/verifiable-credential';
import { CredentialResponse } from '../models/dto/CredentialResponse';

/**
 * Parses raw credential JWTs (jwt_vc_json or dc+sd-jwt) into
 * the VerifiableCredential model used throughout the wallet UI.
 *
 * This replaces the backend parsing that CredentialServiceImpl does in server mode.
 */
@Injectable({ providedIn: 'root' })
export class CredentialParserService {

  private readonly jwtService = inject(JwtService);
  private readonly sdJwtParser = inject(SdJwtParserService);

  /**
   * Parse the first credential in a CredentialResponse into a VerifiableCredential.
   */
  parseCredentialResponse(
    credentialResponse: CredentialResponse,
    format: string
  ): VerifiableCredential {
    const rawCredential = credentialResponse.credentials?.[0]?.credential;
    if (!rawCredential) {
      throw new Error('No credential found in response');
    }
    return this.parseRawCredential(rawCredential, format);
  }

  /**
   * Parse a single raw credential string (JWT or SD-JWT) into VerifiableCredential.
   */
  parseRawCredential(rawCredential: string, format: string): VerifiableCredential {
    if (this.sdJwtParser.isSdJwt(rawCredential)) {
      return this.parseSdJwtCredential(rawCredential, format);
    }
    return this.parseJwtCredential(rawCredential, format);
  }

  private parseJwtCredential(jwt: string, format: string): VerifiableCredential {
    const payload = this.jwtService.parseJwtPayload(jwt) as Record<string, any>;
    const vc = payload['vc'] ?? payload;

    return this.buildVerifiableCredential(vc, jwt, format);
  }

  private parseSdJwtCredential(compact: string, format: string): VerifiableCredential {
    const { payload } = this.sdJwtParser.reconstructClaims(compact);

    // SD-JWT wraps the credential differently — claims are at the top level
    const vc: Record<string, any> = {
      '@context': payload['@context'] ?? [],
      id: payload['jti'] ?? payload['id'] ?? `urn:uuid:${globalThis.crypto.randomUUID()}`,
      type: payload['type'] ?? payload['vct'] ? [payload['vct']] : ['VerifiableCredential'],
      issuer: this.extractIssuer(payload),
      credentialSubject: payload['credentialSubject'] ?? { mandate: payload['mandate'] },
      validFrom: this.extractValidFrom(payload),
      validUntil: this.extractValidUntil(payload),
      credentialStatus: payload['credentialStatus'] ?? this.defaultCredentialStatus(),
    };

    return this.buildVerifiableCredential(vc, compact, format);
  }

  private buildVerifiableCredential(
    vc: Record<string, any>,
    credentialEncoded: string,
    format: string
  ): VerifiableCredential {
    const id = vc['id'] ?? vc['jti'] ?? `urn:uuid:${globalThis.crypto.randomUUID()}`;
    const types = this.extractTypes(vc);
    const issuer = this.extractIssuer(vc);
    const validFrom = this.extractValidFrom(vc);
    const validUntil = this.extractValidUntil(vc);

    const credentialSubject = (vc['credentialSubject'] ?? {}) as CredentialSubject;
    const credentialStatus = (vc['credentialStatus'] ?? this.defaultCredentialStatus()) as CredentialStatus;

    // Determine lifecycle status: credentials parsed client-side are always VALID
    const lifeCycleStatus: LifeCycleStatus = 'VALID';

    return {
      '@context': vc['@context'] ?? ['https://www.w3.org/2018/credentials/v1'],
      id,
      type: types,
      lifeCycleStatus,
      name: vc['name'],
      description: vc['description'],
      issuer,
      validFrom,
      validUntil,
      credentialSubject,
      credentialStatus,
      credentialEncoded,
      credentialFormat: format,
    };
  }

  private extractTypes(vc: Record<string, any>): ExtendedCredentialType[] {
    const rawTypes = vc['type'] ?? vc['vct'];
    if (Array.isArray(rawTypes)) return rawTypes;
    if (typeof rawTypes === 'string') return ['VerifiableCredential', rawTypes] as ExtendedCredentialType[];
    return ['VerifiableCredential'];
  }

  private extractIssuer(vc: Record<string, any>): Issuer {
    const raw = vc['issuer'] ?? vc['iss'];
    if (typeof raw === 'string') {
      return { id: raw };
    }
    if (typeof raw === 'object' && raw !== null) {
      return {
        id: raw['id'] ?? raw['iss'] ?? '',
        organization: raw['organization'],
        organizationIdentifier: raw['organizationIdentifier'],
        country: raw['country'],
        commonName: raw['commonName'],
        serialNumber: raw['serialNumber'],
      };
    }
    return { id: '' };
  }

  private extractValidFrom(vc: Record<string, any>): string {
    if (vc['validFrom']) return vc['validFrom'];
    if (vc['issuanceDate']) return vc['issuanceDate'];
    const iat = vc['iat'] as number | undefined;
    if (iat) return new Date(iat * 1000).toISOString();
    return new Date().toISOString();
  }

  private extractValidUntil(vc: Record<string, any>): string {
    if (vc['validUntil']) return vc['validUntil'];
    if (vc['expirationDate']) return vc['expirationDate'];
    const exp = vc['exp'] as number | undefined;
    if (exp) return new Date(exp * 1000).toISOString();
    return '';
  }

  private defaultCredentialStatus(): CredentialStatus {
    return {
      id: '',
      type: '',
      statusPurpose: '',
      statusListIndex: '',
      statusListCredential: '',
    };
  }
}
