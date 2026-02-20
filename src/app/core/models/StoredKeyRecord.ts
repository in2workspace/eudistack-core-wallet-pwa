export interface StoredKeyRecord {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey; // Opaque object, non-exportable
  publicKey: CryptoKey;
  kid: string; // JWK thumbprint (RFC 7638)
  createdAt: string;
}


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

export interface AlgorithmParams {
  algorithm: EcKeyGenParams;   // For generateKey() with ECDSA
  usages: KeyUsage[];          // ['sign','verify']
}

export type RawKeyAlgorithm = 'ES256'; // For now we only support ES256