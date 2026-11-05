import { Injectable, inject } from '@angular/core';
import { PasskeyPrfAdapterError } from '../models/error/PasskeyPrfAdapterError';
import { KeyStorageProvider, OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';
import { ProofBuilderService } from '../protocol/oid4vci/proof-builder.service';
import { base64UrlDecode, base64UrlEncode } from '../utils/base64url';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { PrfSaltApi } from 'src/app/features/passkey-prf-keymanager/prf-salt.api';
import { PasskeyPrfHolderKeyService } from 'src/app/features/passkey-prf-keymanager/passkey-prf-holder-key.service';

/**
 * Holder keys of a tenant with passkey custody (EUD-11 design §2.2). The service never has a private key:
 * on every signature the key is derived on this device from the PRF of the passkey of the session and the
 * salt of the attestation, used once and dropped. Each signature uses the passkey.
 */
@Injectable()
export class ServerPasskeyPrfKeyStorageProvider extends KeyStorageProvider {
  private readonly server = inject(ServerKeyStorageProvider);
  private readonly saltApi = inject(PrfSaltApi);
  private readonly holderKey = inject(PasskeyPrfHolderKeyService);
  private readonly proofBuilder = inject(ProofBuilderService);

  /**
   * Asks for the salt of the new attestation, derives its key and signs the OID4VCI proof of possession
   * with it. The key is dropped when this returns, so the engine receives the proof already built
   * (`prebuiltJwsProof`) and never calls `sign()` while obtaining the attestation.
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
      throw new PasskeyPrfAdapterError(
        'Passkey custody key generation requires an OID4VCI issuance context (credentialId, format)'
      );
    }

    const material = await this.saltApi.create(context.credentialId);
    const { privateKey, publicKeyJwk } = await this.holderKey.derive(base64UrlDecode(material.prf_salt), material.kdf.info);
    const jwsProof = await this.signProof(privateKey, publicKeyJwk, context);

    return {
      // The credential id is the key id: it is what the service stores the salt under and what
      // `wallet_credential.holder_key_id` keeps, so a presentation finds the salt by it.
      keyId: context.credentialId,
      algorithm: 'ES256',
      publicKeyJwk,
      kid: await this.computeJwkThumbprint(publicKeyJwk),
      createdAt: new Date().toISOString(),
      prebuiltJwsProof: jwsProof,
    };
  }

  /**
   * Signs `data` with the key of the attestation `keyId`. Asks for the salt and the public key stored
   * with the attestation, derives the key and compares its public key with the stored one: if they differ
   * it does not sign. The key is dropped after signing.
   *
   * @returns the raw ES256 signature (r || s, 64 bytes)
   */
  override async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const material = await this.saltApi.get(keyId);
    const { privateKey, publicKeyJwk } = await this.holderKey.derive(base64UrlDecode(material.prf_salt), material.kdf.info);

    if (!material.public_jwk
      || await this.computeJwkThumbprint(publicKeyJwk) !== await this.computeJwkThumbprint(material.public_jwk)) {
      throw new PasskeyPrfAdapterError('The derived key is not the key of this attestation', {
        code: 'key_mismatch',
        translationKey: 'errors.passkey-key-mismatch',
      });
    }

    const signature = await globalThis.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, data.slice());
    return new Uint8Array(signature);
  }

  override hasKey(keyId: string): Promise<boolean> {
    return this.server.hasKey(keyId);
  }

  override deleteKey(): Promise<void> {
    return this.server.deleteKey();
  }

  override listKeys(): Promise<KeyInfo[]> {
    return this.server.listKeys();
  }

  override isCnfBoundToPublicKey(cnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    return this.server.isCnfBoundToPublicKey(cnf, publicKeyJwk);
  }

  override resolveKeyIdByKid(): Promise<string | null> {
    return this.server.resolveKeyIdByKid();
  }

  private async signProof(
    privateKey: CryptoKey,
    publicKeyJwk: JsonWebKey,
    context: OID4VCIKeyGenContext
  ): Promise<string> {
    const { header, payload } = this.proofBuilder.createHeaderAndPayload(
      context.cNonce ?? '',
      context.issuerIdentifier,
      publicKeyJwk
    );
    const enc = new TextEncoder();
    const signingInput =
      `${base64UrlEncode(enc.encode(JSON.stringify(header)))}.` +
      base64UrlEncode(enc.encode(JSON.stringify(payload)));

    const signature = await globalThis.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      enc.encode(signingInput)
    );

    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }
}
