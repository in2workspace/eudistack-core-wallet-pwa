import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KeyStorageProvider, OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { environment } from 'src/environments/environment';
import { base64UrlEncode, base64UrlDecode } from '../utils/base64url';

interface KeyGenerateResponseDto {
  key_id: string;
  public_jwk: JsonWebKey;
  jws_proof: string;
  warning?: string;
}

interface SignResponseDto {
  signature: string;
}

interface KeyInfoResponseDto {
  keyId: string;
  algorithm: string;
  publicKeyJwk: JsonWebKey;
  kid: string;
  exists: boolean;
  createdAt: string;
}

interface CredentialListItemDto {
  id: string;
  kid?: string;
  holder_key_id?: string;
  credentialFormat?: string;
}

const CREDENTIALS_API = '/api/v1/credentials';

@Injectable()
export class ServerKeyStorageProvider extends KeyStorageProvider {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.server_url;

  /** Session-scoped cache: kid (JWK thumbprint) → PublicKeyInfo. Populated on generateKeyPair. */
  private readonly keyCache = new Map<string, PublicKeyInfo>();

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string, context?: OID4VCIKeyGenContext): Promise<PublicKeyInfo> {
    const url = `${this.baseUrl}/api/v1/keys/generate`;
    const body = context
      ? {
          credential_id: context.credentialId,
          format: context.format,
          supported_algs: context.supportedAlgs,
          issuer_identifier: context.issuerIdentifier,
          c_nonce: context.cNonce,
        }
      : { algorithm, keyId };
    const response = await firstValueFrom(
      this.http.post<KeyGenerateResponseDto>(url, body)
    );
    const publicKeyJwk = response.public_jwk as JsonWebKey;
    const kid = await this.computeJwkThumbprint(publicKeyJwk);
    const info: PublicKeyInfo = {
      keyId: response.key_id,
      algorithm: 'ES256',
      publicKeyJwk,
      kid,
      createdAt: new Date().toISOString(),
      prebuiltJwsProof: response.jws_proof,
    };
    this.keyCache.set(kid, info);
    this.keyCache.set(response.key_id, info);
    return info;
  }

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    // Fallback path — not used when buildPresentationJws is available.
    const url = `${this.baseUrl}/api/v1/keys/${encodeURIComponent(keyId)}/sign`;
    const response = await firstValueFrom(
      this.http.post<SignResponseDto>(url, { data: base64UrlEncode(data) })
    );
    return base64UrlDecode(response.signature);
  }

  override async buildPresentationJws(
    keyId: string,
    payload: Record<string, unknown>,
    signingType: 'KB_JWT' | 'VP_ENVELOPE'
  ): Promise<string> {
    const url = `${this.baseUrl}/api/v1/keys/${encodeURIComponent(keyId)}/sign`;
    const signingInput = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
    const response = await firstValueFrom(
      this.http.post<{ jws: string }>(url, {
        signing_type: signingType,
        purpose: 'PRESENTATION',
        signing_input: signingInput,
      })
    );
    return response.jws;
  }

  async hasKey(keyId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/v1/keys/${encodeURIComponent(keyId)}`;
      const response = await firstValueFrom(
        this.http.get<KeyInfoResponseDto>(url)
      );
      return response.exists;
    } catch {
      return false;
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    const url = `${this.baseUrl}/api/v1/keys/${encodeURIComponent(keyId)}`;
    await firstValueFrom(this.http.delete<void>(url));
  }

  async listKeys(): Promise<KeyInfo[]> {
    const url = `${this.baseUrl}${CREDENTIALS_API}`;
    const credentials = await firstValueFrom(
      this.http.get<CredentialListItemDto[]>(url)
    );
    return credentials
      .filter(c => c.holder_key_id != null)
      .map(c => ({
        keyId: c.holder_key_id!,
        algorithm: 'ES256' as RawKeyAlgorithm,
        createdAt: '',
      }));
  }

  async isCnfBoundToPublicKey(unparsedCnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    const cnf = unparsedCnf as any;
    if (!cnf) return false;

    const proofThumbprint = await this.computeJwkThumbprint(publicKeyJwk);

    if (cnf.jwk) {
      const cnfThumbprint = await this.computeJwkThumbprint(cnf.jwk as JsonWebKey);
      return cnfThumbprint === proofThumbprint;
    }
    return false;
  }

  async resolveKeyIdByKid(kid: string): Promise<string | null> {
    const url = `${this.baseUrl}${CREDENTIALS_API}`;
    const credentials = await firstValueFrom(
      this.http.get<CredentialListItemDto[]>(url)
    );
    const match = credentials.find(c => c.kid === kid && c.holder_key_id != null);
    return match?.holder_key_id ?? null;
  }

  async exportKey(keyId: string): Promise<JsonWebKey> {
    const url = `${this.baseUrl}/api/v1/keys/${encodeURIComponent(keyId)}/export`;
    return firstValueFrom(this.http.get<JsonWebKey>(url));
  }

  async importKey(keyId: string, jwk: JsonWebKey): Promise<void> {
    const url = `${this.baseUrl}/api/v1/keys/import`;
    await firstValueFrom(this.http.post<void>(url, { keyId, jwk }));
  }
}
