import { RawKeyAlgorithm, PublicKeyInfo } from "../models/StoredKeyRecord";

export abstract class KeyStorageProvider {
  abstract generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo>;
  abstract sign(keyId: string, data: Uint8Array): Promise<Uint8Array>;
  abstract isCnfBoundToPublicKey(
    cnf: unknown,
    publicKeyJwk: JsonWebKey
  ): Promise<boolean>;

}