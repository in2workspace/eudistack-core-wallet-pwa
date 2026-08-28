import { Injectable, inject } from '@angular/core';
import { AppError } from '../models/error/AppError';
import { HybridAdapterError } from '../models/error/HybridAdapterError';
import { KeyStorageProvider, OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { HybridKeyEnrollmentService } from 'src/app/features/hybrid-keymanager/hybrid-key-enrollment.service';
import { SignService } from 'src/app/features/hybrid-keymanager/sign.service';

@Injectable()
export class HybridKeyStorageProvider extends KeyStorageProvider {
  private readonly server = inject(ServerKeyStorageProvider);
  private readonly enrollment = inject(HybridKeyEnrollmentService);
  private readonly signService = inject(SignService);

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
      // `hybrid_wrapped_key_handle`, keyed by (holder_id, credential_id)). Using
      // the real credentialId as keyId lets buildPresentationJws() round-trip it
      // straight back via resolveKeyIdByKid() — no separate mapping table needed.
      // wallet_credential.holder_key_id was widened to VARCHAR(512) to fit it
      // (V5__widen_holder_key_id_for_hybrid.sql).
      keyId: context.credentialId,
      algorithm: 'ES256',
      publicKeyJwk,
      kid,
      createdAt: new Date().toISOString(),
      prebuiltJwsProof: jwsProof,
    };
  }

  /**
   * Signing a raw payload (not a full presentation) is not a hybrid use case today —
   * `buildPresentationJws` covers OID4VP, and the OID4VCI proof is signed inline during
   * `generateKeyPair` (`prebuiltJwsProof`). Kept as an explicit, typed failure rather than
   * silently delegating to `sign.service`'s two-step handshake with a raw byte payload it
   * cannot turn into a valid signing_input.
   */
  override async sign(_keyId: string, _data: Uint8Array): Promise<Uint8Array> {
    throw new HybridAdapterError(
      'Hybrid sign() is not supported — use buildPresentationJws for OID4VP presentations',
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

  /**
   * `keyId` is the real `credentialId` (see generateKeyPair) — passed straight through to
   * `SignService.sign()`, which drives the prepare/PRF-unwrap/sign/submit handshake (US-04).
   * `signingType` maps 1:1 to the credential `format` the backend expects (inverse of
   * `PrepareSignUseCase.formatFrom`, EUDISTACK-536).
   */
  override async buildPresentationJws?(
    keyId: string,
    payload: Record<string, unknown>,
    signingType: 'KB_JWT' | 'VP_ENVELOPE'
  ): Promise<string> {
    const format = signingType === 'KB_JWT' ? 'vc+sd-jwt' : 'jwt_vc_json';
    return this.signService.sign(keyId, payload, format);
  }

  override exportKey?(keyId: string): Promise<JsonWebKey> {
    return this.server.exportKey!(keyId);
  }

  override importKey?(keyId: string, jwk: JsonWebKey): Promise<void> {
    return this.server.importKey!(keyId, jwk);
  }
}
