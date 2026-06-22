import { Injectable, inject } from '@angular/core';
import { HybridAdapterError } from '../models/error/HybridAdapterError';
import { KeyStorageProvider, OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { ServerKeyStorageProvider } from './server-key-storage.service';

@Injectable()
export class HybridKeyStorageProvider extends KeyStorageProvider {
  private readonly server = inject(ServerKeyStorageProvider);

  override generateKeyPair(
    algorithm: RawKeyAlgorithm,
    keyId: string,
    context?: OID4VCIKeyGenContext
  ): Promise<PublicKeyInfo> {
    return this.server.generateKeyPair(algorithm, keyId, context);
  }

  override async sign(_keyId: string, _data: Uint8Array): Promise<Uint8Array> {
    // TODO(EUDISTACK-536 / US-04): implement two-step hybrid signing:
    throw new HybridAdapterError(
      'Hybrid sign not yet implemented — pending US-04 (EUDISTACK-536)',
      { code: 'prepare_sign_failed' }
    );
  }

  override hasKey(keyId: string): Promise<boolean> {
    return this.server.hasKey(keyId);
  }

  override deleteKey(keyId: string): Promise<void> {
    return this.server.deleteKey(keyId);
  }

  override listKeys(): Promise<KeyInfo[]> {
    return this.server.listKeys();
  }

  override isCnfBoundToPublicKey(cnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    return this.server.isCnfBoundToPublicKey(cnf, publicKeyJwk);
  }

  override resolveKeyIdByKid(kid: string): Promise<string | null> {
    return this.server.resolveKeyIdByKid(kid);
  }

  override buildPresentationJws?(
    keyId: string,
    payload: Record<string, unknown>,
    signingType: 'KB_JWT' | 'VP_ENVELOPE'
  ): Promise<string> {
    throw new HybridAdapterError(
      'Hybrid buildPresentationJws not yet implemented — pending US-04 (EUDISTACK-536)',
      { code: 'prepare_sign_failed' }
    );
  }

  override exportKey?(keyId: string): Promise<JsonWebKey> {
    return this.server.exportKey!(keyId);
  }

  override importKey?(keyId: string, jwk: JsonWebKey): Promise<void> {
    return this.server.importKey!(keyId, jwk);
  }
}
