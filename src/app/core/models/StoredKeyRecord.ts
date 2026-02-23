export type StoredPublicKeyRecord = {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  kid: string;
  createdAt: string;
};

export type StoredFullKeyRecord = StoredPublicKeyRecord & {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export type StoredAnyKeyRecord = StoredPublicKeyRecord | StoredFullKeyRecord;

export function isFullRecord(r: StoredAnyKeyRecord): r is StoredFullKeyRecord {
  return !!(r as any).privateKey && !!(r as any).publicKey;
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