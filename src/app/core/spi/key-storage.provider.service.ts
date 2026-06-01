import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from "../models/StoredKeyRecord";
import { base64UrlEncode } from "../utils/base64url";
import { AppError } from "src/app/core/models/error/AppError";

/** OID4VCI context passed to server-mode key generation (ignored in browser mode). */
export interface OID4VCIKeyGenContext {
  credentialId: string;
  format: string;
  supportedAlgs: string[];
  issuerIdentifier: string;
  cNonce?: string;
}

export abstract class KeyStorageProvider {
  abstract generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string, context?: OID4VCIKeyGenContext): Promise<PublicKeyInfo>;
  abstract sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;
  /** Server mode only: build a complete JWS for a presentation payload (EBW builds header+sig). */
  buildPresentationJws?(keyId: string, payload: Record<string, unknown>, signingType: 'KB_JWT' | 'VP_ENVELOPE'): Promise<string>;
  abstract hasKey(keyId: string): Promise<boolean>;
  abstract deleteKey(keyId: string): Promise<void>;
  abstract listKeys(): Promise<KeyInfo[]>;
  abstract isCnfBoundToPublicKey(
    cnf: unknown,
    publicKeyJwk: JsonWebKey
  ): Promise<boolean>;
  abstract resolveKeyIdByKid(kid: string): Promise<string | null>;

  // Optional backup methods (Enterprise)
  abstract exportKey?(keyId: string): Promise<JsonWebKey>;
  abstract importKey?(keyId: string, jwk: JsonWebKey): Promise<void>;

  /** Optional lifecycle hook; implementations may override. */
  async init(): Promise<void> { /* no-op by default */ }

  /**
   * Computes JWK thumbprint according to RFC 7638.
   * For EC keys: required members are crv, kty, x, y (lexicographic order).
   * Pure client-side computation — no secrets involved.
   */
  async computeJwkThumbprint(jwk: JsonWebKey): Promise<string> {
    const { crv, kty, x, y } = jwk;
    if (!crv || !kty || !x || !y) {
      throw new AppError('Invalid EC public JWK: missing required parameters (crv, kty, x, y).', {
        translationKey: 'errors.invalid-public-jwk',
      });
    }

    const thumbprintInput = JSON.stringify({ crv, kty, x, y });
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(thumbprintInput)
    );
    return base64UrlEncode(new Uint8Array(digest));
  }
}