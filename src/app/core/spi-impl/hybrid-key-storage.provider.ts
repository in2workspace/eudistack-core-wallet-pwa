import { Injectable, inject } from '@angular/core';
import { AppError } from '../models/error/AppError';
import { HybridAdapterError } from '../models/error/HybridAdapterError';
import { KeyStorageProvider, OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { HybridKeyEnrollmentService } from 'src/app/features/hybrid-keymanager/hybrid-key-enrollment.service';

@Injectable()
export class HybridKeyStorageProvider extends KeyStorageProvider {
  private readonly server = inject(ServerKeyStorageProvider);
  private readonly enrollment = inject(HybridKeyEnrollmentService);

  /**
   * Generates the holder key for a credential client-side (PRF wrap + EBW onboarding
   * commit) instead of delegating to `ServerKeyStorageProvider` — the DB-only
   * `/api/v1/keys/generate` endpoint always 403s for `key_manager=hybrid` tenants
   * (backend requires wallet profile (SERVER, DB); see KeyManagerController).
   *
   * The OID4VCI proof is signed with the holder key before it is wrapped and
   * zeroized (`prebuiltJwsProof`), so the engine never needs `sign()` for issuance.
   */
  override async generateKeyPair(
    _algorithm: RawKeyAlgorithm,
    _keyId: string,
    context?: OID4VCIKeyGenContext
  ): Promise<PublicKeyInfo> {
    if (!context) {
      // Defensive: every real caller reaching this provider (oid4vci.engine) always
      // supplies a context. DPoP's ephemeral keys bypass this provider entirely
      // (DpopService injects PasskeyPrfKeyStorageProvider directly).
      throw new AppError(
        'Hybrid key generation requires an OID4VCI issuance context (credentialId, format)',
        { code: 'unknown' }
      );
    }

    const { publicKeyJwk, jwsProof } = await this.enrollment.enroll(context);
    const kid = await this.computeJwkThumbprint(publicKeyJwk);

    return {
      // Hybrid has no server-side `holder_key` row (the wrapped key lives in
      // `hybrid_wrapped_key_handle`, keyed by (holder_id, credential_id) — not
      // by a key_id UUID). The engine's `keyId` param is `credentialIssuer:
      // credentialConfigurationId`, far longer than the `wallet_credential.
      // holder_key_id VARCHAR(36)` column it ends up in — using it verbatim
      // overflows that column. Generate an opaque UUID instead; nothing
      // dereferences it server-side for hybrid credentials today.
      keyId: crypto.randomUUID(),
      algorithm: 'ES256',
      publicKeyJwk,
      kid,
      createdAt: new Date().toISOString(),
      prebuiltJwsProof: jwsProof,
    };
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

  override async buildPresentationJws?(
    keyId: string,
    payload: Record<string, unknown>,
    signingType: 'KB_JWT' | 'VP_ENVELOPE'
  ): Promise<string> {
    return Promise.reject(new HybridAdapterError(
      'Hybrid buildPresentationJws not yet implemented — pending US-04 (EUDISTACK-536)',
      { code: 'prepare_sign_failed' }
    ));
  }

  override exportKey?(keyId: string): Promise<JsonWebKey> {
    return this.server.exportKey!(keyId);
  }

  override importKey?(keyId: string, jwk: JsonWebKey): Promise<void> {
    return this.server.importKey!(keyId, jwk);
  }
}
