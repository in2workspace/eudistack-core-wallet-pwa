export type StoredPublicKeyRecord = {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  kid: string;
  createdAt: string;
};

export interface PublicKeyInfo {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  kid: string; // JWK thumbprint (RFC 7638)
  createdAt: string;
  /** Pre-built JWS proof from server-side key generation (compact serialization). Present only in server wallet mode. */
  prebuiltJwsProof?: string;
}

export interface KeyInfo {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  createdAt: string;
}

export type RawKeyAlgorithm = 'ES256'; // For now we only support ES256