export abstract class KeyStorageProvider {
  abstract generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo>;
  abstract sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;
  abstract hasKey(keyId: string): Promise<boolean>;
  abstract deleteKey(keyId: string): Promise<void>;
  abstract listKeys(): Promise<KeyInfo[]>;
  abstract isCnfBoundToPublicKey(
    cnf: unknown,
    publicKeyJwk: JsonWebKey
  ): Promise<boolean>;

  // Backup opcional (Enterprise)
  abstract exportKey?(keyId: string): Promise<JsonWebKey>;
  abstract importKey?(keyId: string, jwk: JsonWebKey): Promise<void>;
}

export type RawKeyAlgorithm = 'ES256';

export interface PublicKeyInfo {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  kid: string; // JWK thumbprint (RFC 7638)
  createdAt: string;
}

export interface KeyInfo {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  createdAt: string;
}
