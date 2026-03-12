import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { environment } from 'src/environments/environment';
import { base64UrlEncode, base64UrlDecode } from '../utils/base64url';

interface KeyGenerateResponseDto {
  keyId: string;
  algorithm: string;
  publicKeyJwk: JsonWebKey;
  kid: string;
  createdAt: string;
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

interface KeyListItemResponseDto {
  keyId: string;
  algorithm: string;
  kid: string;
  createdAt: string;
}

const KEYS_API = '/api/v1/keys';

@Injectable()
export class ServerKeyStorageProvider extends KeyStorageProvider {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.server_url;

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    const url = `${this.baseUrl}${KEYS_API}/generate`;
    const response = await firstValueFrom(
      this.http.post<KeyGenerateResponseDto>(url, { algorithm, keyId })
    );
    return {
      keyId: response.keyId,
      algorithm: response.algorithm as RawKeyAlgorithm,
      publicKeyJwk: response.publicKeyJwk,
      kid: response.kid,
      createdAt: response.createdAt,
    };
  }

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const url = `${this.baseUrl}${KEYS_API}/${encodeURIComponent(keyId)}/sign`;
    const response = await firstValueFrom(
      this.http.post<SignResponseDto>(url, { data: base64UrlEncode(data) })
    );
    return base64UrlDecode(response.signature);
  }

  async hasKey(keyId: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}${KEYS_API}/${encodeURIComponent(keyId)}`;
      const response = await firstValueFrom(
        this.http.get<KeyInfoResponseDto>(url)
      );
      return response.exists;
    } catch {
      return false;
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    const url = `${this.baseUrl}${KEYS_API}/${encodeURIComponent(keyId)}`;
    await firstValueFrom(this.http.delete<void>(url));
  }

  async listKeys(): Promise<KeyInfo[]> {
    const url = `${this.baseUrl}${KEYS_API}`;
    const response = await firstValueFrom(
      this.http.get<KeyListItemResponseDto[]>(url)
    );
    return response.map(item => ({
      keyId: item.keyId,
      algorithm: item.algorithm as RawKeyAlgorithm,
      createdAt: item.createdAt,
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
    const url = `${this.baseUrl}${KEYS_API}`;
    const keys = await firstValueFrom(
      this.http.get<KeyListItemResponseDto[]>(url)
    );
    const match = keys.find(k => k.kid === kid);
    return match?.keyId ?? null;
  }

  async exportKey(keyId: string): Promise<JsonWebKey> {
    const url = `${this.baseUrl}${KEYS_API}/${encodeURIComponent(keyId)}/export`;
    return firstValueFrom(this.http.get<JsonWebKey>(url));
  }

  async importKey(keyId: string, jwk: JsonWebKey): Promise<void> {
    const url = `${this.baseUrl}${KEYS_API}/import`;
    await firstValueFrom(this.http.post<void>(url, { keyId, jwk }));
  }
}
