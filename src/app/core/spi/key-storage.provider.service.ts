import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo } from "../models/StoredKeyRecord";

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

  // Optional backup methods (Enterprise)
  // abstract exportKey?(keyId: string): Promise<JsonWebKey>;
  // abstract importKey?(keyId: string, jwk: JsonWebKey): Promise<void>;
}