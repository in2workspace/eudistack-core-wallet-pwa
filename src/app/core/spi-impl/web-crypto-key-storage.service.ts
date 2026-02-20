import { Injectable } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { StoredKeyRecord, RawKeyAlgorithm, PublicKeyInfo, KeyInfo, AlgorithmParams } from '../models/StoredKeyRecord';

type BrowserKeyStorageMode = 'full' | 'public-only';

//todo review browser compatibility - storing of crypto keys in IndexedDB especially
@Injectable({ providedIn: 'root' })
export class WebCryptoKeyStorageProvider extends KeyStorageProvider {
  private readonly DB_NAME = 'wallet-key-storage';
  private readonly STORE_NAME = 'keys';
  private readonly DB_VERSION = 1;

  public storageMode: BrowserKeyStorageMode | null = null;
  private compatPromise: Promise<void> | null = null;
  private keyCache = new Map<string, { privateKey: CryptoKey; publicKey: CryptoKey }>();

  constructor() {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      throw new Error(
        'Web Crypto API (crypto.subtle) is not available. Ensure you are using a modern browser and HTTPS.'
      );
    }

    if (!globalThis.indexedDB) {
      throw new Error('IndexedDB is not available in this environment.');
    }

    super();
  }

  //todo consier executing in initialization
  public checkBrowserCompatibility(): Promise<void> {
    if (this.storageMode !== null) return Promise.resolve();

    if (!this.compatPromise) {
      this.compatPromise = this.runCompatibilityCheckOnce();
    }
    return this.compatPromise;
  }

  private async runCompatibilityCheckOnce(): Promise<void> {
    this.storageMode = await this.selfTestStorageMode();

    if (this.storageMode === 'public-only') {
      console.warn(
        'CryptoKey cannot be persisted in IndexedDB in this browser. Falling back to public-key-only persistence.'
      );
    }
  }
  private async selfTestStorageMode(): Promise<BrowserKeyStorageMode> {
    const testKeyId = `__compat_test__${globalThis.crypto.randomUUID?.() ?? String(Date.now())}`;
    let saved = false;

    try {
      const params = this.getAlgorithmParams('ES256');
      const keyPair = await globalThis.crypto.subtle.generateKey(params.algorithm, false, params.usages);

      const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);

      const record: StoredKeyRecord = {
        keyId: testKeyId,
        algorithm: 'ES256',
        publicKeyJwk,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        kid: 'compat-test',
        createdAt: new Date().toISOString(),
      };

      // Force "full" mode for the test write.
      // If IndexedDB can't clone CryptoKey, this will throw.
      await this.saveKeyRecordInternal(record, 'full');
      saved = true;

      const loaded = await this.getKeyRecord(testKeyId);
      if (!loaded?.privateKey || !loaded?.publicKey) return 'public-only';

      // Validate that recovered keys are usable.
      const data = new TextEncoder().encode('compat');
      const sig = await globalThis.crypto.subtle.sign(this.getSignatureParams('ES256'), loaded.privateKey, data);

      const ok = await globalThis.crypto.subtle.verify(
        this.getSignatureParams('ES256'),
        loaded.publicKey,
        sig,
        data
      );

      return ok ? 'full' : 'public-only';
    } catch (e) {
      console.warn('CryptoKey/IndexedDB full persistence test failed:', e);
      return 'public-only';
    } finally {
      if (saved) {
        try {
          await this.deleteKey(testKeyId);
        } catch {
          // Ignore cleanup failures.
        }
      }
    }
  }

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    await this.checkBrowserCompatibility();

    const params = this.getAlgorithmParams(algorithm);
    console.log("Generating key pair with params:", params);

    // Generate NON-EXTRACTABLE key pair (critical).
    // We assume it is a key pair because currently only ECDSA is supported (with symmetric algorithms only one is returned).
    const keyPair = await globalThis.crypto.subtle.generateKey(
      params.algorithm,
      false, // extractable = false
      params.usages
    );
    console.log("Key pair generated:", keyPair);
    this.keyCache.set(keyId, { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey });


    const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);

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
    await this.checkBrowserCompatibility();

    const record = await this.getKeyRecord(keyId);
    if (!record) throw new Error(`Key not found: ${keyId}`);

    const params = this.getSignatureParams(record.algorithm);

    let privateKey: CryptoKey | undefined;

    if (this.storageMode === 'full') {
      privateKey = record.privateKey;
    } else {
      privateKey = this.keyCache.get(keyId)?.privateKey;
    }

    if (!privateKey) {
      throw new Error(
        'Private key is not available in this browser session. ' +
        'This browser cannot persist CryptoKey in IndexedDB (public-key-only mode). ' +
        'Regenerate or re-import the key in this session, and avoid reloading the page.'
      );
    }

    const signature = await globalThis.crypto.subtle.sign(params, privateKey, new Uint8Array(data));
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
    this.keyCache.delete(keyId);
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
      return await globalThis.crypto.subtle.exportKey('jwk', record.privateKey);
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
    const privateKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk,
      params.algorithm,
      false, // extractable = false
      ['sign']
    );

    // Build public JWK (remove private component).
    const publicKeyJwk: JsonWebKey = { ...jwk };
    delete (publicKeyJwk as any).d;

    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      params.algorithm,
      true, // public key can be extractable
      ['verify']
    );

    this.keyCache.set(keyId, { privateKey, publicKey });

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

    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(thumbprintInput));
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
        const transaction = request.transaction;
        if (!transaction) throw new Error('IndexedDB upgrade transaction not available.');

        const store = db.objectStoreNames.contains(this.STORE_NAME)
          ? transaction.objectStore(this.STORE_NAME)
          : db.createObjectStore(this.STORE_NAME, { keyPath: 'keyId' });

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
  await this.checkBrowserCompatibility();
  await this.saveKeyRecordInternal(record, this.storageMode ?? 'public-only');
}

private async saveKeyRecordInternal(record: StoredKeyRecord, mode: BrowserKeyStorageMode): Promise<void> {
  // English-only comments by convention.
  const db = await this.openDatabase();
  const tx = db.transaction(this.STORE_NAME, 'readwrite');
  const store = tx.objectStore(this.STORE_NAME);

  const toPersist: any =
    mode === 'public-only'
      ? {
          keyId: record.keyId,
          algorithm: record.algorithm,
          publicKeyJwk: record.publicKeyJwk,
          kid: record.kid,
          createdAt: record.createdAt,
        }
      : record;

  await this.wrapRequest(store.put(toPersist));
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

    if (!store.indexNames.contains('kid')) {
      await this.awaitTx(tx);
      db.close();
      throw new Error(
        "IndexedDB schema is missing the 'kid' index. Delete the 'wallet-key-storage' database in DevTools and reload."
      );
    }

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

  let out = b64.split('+').join('-').split('/').join('_');

  while (out.endsWith('=')) {
    out = out.slice(0, -1);
  }

  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x2000; //todo review

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}