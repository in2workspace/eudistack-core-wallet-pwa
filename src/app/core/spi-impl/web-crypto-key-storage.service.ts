import { Injectable } from '@angular/core';
import { KeyInfo, KeyStorageProvider, PublicKeyInfo, RawKeyAlgorithm } from '../spi/key-storage.provider.service';

interface StoredKeyRecord {
  keyId: string;
  algorithm: RawKeyAlgorithm;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey; // Opaque object, non-exportable
  publicKey: CryptoKey;
  kid: string; // JWK thumbprint (RFC 7638)
  createdAt: string;
}

interface AlgorithmParams {
  algorithm: EcKeyGenParams;   // For generateKey() with ECDSA
  usages: KeyUsage[];          // ['sign','verify']
}

//todo review browser compatibility - storing of crypto keys in IndexedDB especially
@Injectable({ providedIn: 'root' })
export class WebCryptoKeyStorageProvider extends KeyStorageProvider {
  private readonly DB_NAME = 'wallet-key-storage';
  private readonly STORE_NAME = 'keys';
  private readonly DB_VERSION = 1; //todo

  constructor() {
    //todo review
    if (!globalThis.crypto?.subtle) {
      throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
    }
    if (!globalThis.indexedDB) {
      throw new Error('IndexedDB is not available in this environment.');
    }
    super();
  }

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    const params = this.getAlgorithmParams(algorithm);
    console.log("Generating key pair with params:", params);

    // Generate NON-EXTRACTABLE key pair (critical).
    // We assume it is a key pair because currently only ECDSA is supported (with symmetric algorithms only one is returned).
    const keyPair = await crypto.subtle.generateKey(
      params.algorithm,
      false, // extractable = false
      params.usages
    );
    console.log("Key pair generated:", keyPair);


    const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // Compute kid as JWK thumbprint (RFC 7638).
    const kid = await this.computeJwkThumbprint(publicKeyJwk);

    const createdAt = new Date().toISOString();

    const record: StoredKeyRecord = {
      keyId,
      algorithm,
      publicKeyJwk,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
      kid,
      createdAt,
    };

    await this.saveKeyRecord(record);

    return {
      keyId,
      algorithm,
      publicKeyJwk,
      kid,
      createdAt,
    };
  }

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
  const record = await this.getKeyRecord(keyId);
  if (!record) throw new Error(`Key not found: ${keyId}`);

  const params = this.getSignatureParams(record.algorithm);

  // Copy into a fresh ArrayBuffer to satisfy BufferSource typings.
  const dataForCrypto = new Uint8Array(data);

  const signature = await globalThis.crypto.subtle.sign(
    params,
    record.privateKey,
    dataForCrypto
  );

  return new Uint8Array(signature);
}

  public async isCnfBoundToPublicKey(unparsedCnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    console.log("Validating if cnf matches public key. Unparsed cnf:");
    console.log(unparsedCnf);
    console.log("Public key JWK:");
    console.log(publicKeyJwk);
    
    const cnf = unparsedCnf as any;
    if (!cnf) return false;

    const proofThumbprint = await this.computeJwkThumbprint(publicKeyJwk);
    console.log("proofThumbprint: " + proofThumbprint);

    if (cnf.jwk) {
      const cnfThumbprint = await this.computeJwkThumbprint(cnf.jwk as JsonWebKey);
      console.log("CNF thumprint: " + cnfThumbprint);
      return cnfThumbprint === proofThumbprint;
    }

    return false;
  }


  async hasKey(keyId: string): Promise<boolean> {
    const record = await this.getKeyRecord(keyId);
    return record !== null;
  }

  async deleteKey(keyId: string): Promise<void> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);

    await this.wrapRequest(store.delete(keyId));
    await this.awaitTx(tx);
    db.close();
  }

  async listKeys(): Promise<KeyInfo[]> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readonly');
    const store = tx.objectStore(this.STORE_NAME);

    const records = await this.wrapRequest(store.getAll()) as StoredKeyRecord[];
    await this.awaitTx(tx);
    db.close();

    return records.map((r) => ({
      keyId: r.keyId,
      algorithm: r.algorithm,
      createdAt: r.createdAt,
    }));
  }

  // --- Optional backup methods (Enterprise) ---

  async exportKey(keyId: string): Promise<JsonWebKey> {
    const record = await this.getKeyRecord(keyId);
    if (!record) {
      throw new Error(`Key not found: ${keyId}`);
    }

    // This will throw if the private key is non-extractable (expected for this provider).
    try {
      return await crypto.subtle.exportKey('jwk', record.privateKey);
    } catch (e) {
      throw new Error(
        'Private key export is not allowed (non-extractable key). Use an Enterprise flow that generates extractable keys + encrypted backup.'
      );
    }
  }

  async importKey(keyId: string, jwk: JsonWebKey): Promise<void> {
    const algorithm = this.jwkToAlgorithm(jwk);
    const params = this.getAlgorithmParams(algorithm);

    // Import private key as NON-EXTRACTABLE.
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      params.algorithm,
      false, // extractable = false
      ['sign']
    );

    // Build public JWK (remove private component).
    const publicKeyJwk: JsonWebKey = { ...jwk };
    delete (publicKeyJwk as any).d;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      params.algorithm,
      true, // public key can be extractable
      ['verify']
    );

    const kid = await this.computeJwkThumbprint(publicKeyJwk);

    await this.saveKeyRecord({
      keyId,
      algorithm,
      publicKeyJwk,
      privateKey,
      publicKey,
      kid,
      createdAt: new Date().toISOString(),
    });
  }

  // --- Private helpers ---

  private getAlgorithmParams(algorithm: RawKeyAlgorithm): AlgorithmParams {
    switch (algorithm) {
      case 'ES256':
        return {
          algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
          usages: ['sign', 'verify'],
        };
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }

  private getSignatureParams(algorithm: RawKeyAlgorithm): EcdsaParams {
    switch (algorithm) {
      case 'ES256':
        return { name: 'ECDSA', hash: 'SHA-256' };
      default:
        throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
  }

  /**
   * Computes JWK thumbprint according to RFC 7638.
   * For EC keys: required members are crv, kty, x, y (lexicographic order).
   */
  public async computeJwkThumbprint(jwk: JsonWebKey): Promise<string> {
    const crv = jwk.crv;
    const kty = jwk.kty;
    const x = jwk.x;
    const y = jwk.y;

    if (!crv || !kty || !x || !y) {
      throw new Error('Invalid EC public JWK: missing required parameters (crv, kty, x, y).');
    }

    const thumbprintInput = JSON.stringify({
      crv: crv,
      kty: kty,
      x: x,
      y: y,
    });

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(thumbprintInput));
    return base64UrlEncode(new Uint8Array(digest));
  }

  private jwkToAlgorithm(jwk: JsonWebKey): RawKeyAlgorithm {
    const kty = jwk.kty;
    const crv = jwk.crv;

    if (kty !== 'EC') {
      throw new Error(`Unsupported key type: ${kty ?? 'unknown'}`);
    }
    if (crv === 'P-256') return 'ES256';
    throw new Error(`Unsupported curve: ${crv ?? 'unknown'}`);
  }

  private async openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;

      // Create store if missing (fresh install)
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(this.STORE_NAME)) {
        store = db.createObjectStore(this.STORE_NAME, { keyPath: 'keyId' });
      } else {
        // Existing DB upgrade
        const tx = request.transaction;
        if (!tx) throw new Error('IndexedDB upgrade transaction not available.');
        store = tx.objectStore(this.STORE_NAME);
      }

      // Create index if missing (upgrade from v1 -> v2)
      if (!store.indexNames.contains('kid')) {
        store.createIndex('kid', 'kid', { unique: true });
      }
    };
  });
}
  private async getKeyRecord(keyId: string): Promise<StoredKeyRecord | null> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readonly');
    const store = tx.objectStore(this.STORE_NAME);

    const record = (await this.wrapRequest(store.get(keyId))) as StoredKeyRecord | undefined;
    await this.awaitTx(tx);
    db.close();

    return record ?? null;
  }

  private async saveKeyRecord(record: StoredKeyRecord): Promise<void> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);

    await this.wrapRequest(store.put(record));
    await this.awaitTx(tx);
    db.close();
  }

  private wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private awaitTx(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  async resolveKeyIdByKid(kid: string): Promise<string | null> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readonly');
    const store = tx.objectStore(this.STORE_NAME);
    const idx = store.index('kid');

    const record = (await this.wrapRequest(idx.get(kid))) as StoredKeyRecord | undefined;

    await this.awaitTx(tx);
    db.close();

    return record?.keyId ?? null;
  }
}

/** Base64url encoding without external dependencies. */
function base64UrlEncode(bytes: Uint8Array): string {
  const b64 = bytesToBase64(bytes);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToBase64(bytes: Uint8Array): string {
  // English-only comments by convention.
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}