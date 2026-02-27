import { Injectable } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import {
  RawKeyAlgorithm,
  PublicKeyInfo,
  KeyInfo,
  AlgorithmParams,
  StoredFullKeyRecord,
  StoredAnyKeyRecord,
  isFullRecord,
} from '../models/StoredKeyRecord';
import { AppError } from 'src/app/interfaces/error/AppError';

type AvailableBrowserKeyStorageMode = 'full' | 'in-memory';
type BrowserKeyStorageMode = AvailableBrowserKeyStorageMode | 'unavailable';

type CachedKeyEntry = {
  keyId: string;
  kid: string;
  algorithm: RawKeyAlgorithm;
  createdAt: string;
  publicKeyJwk: JsonWebKey;
  privateKey?: CryptoKey;
  publicKey?: CryptoKey;
};

@Injectable({ providedIn: 'root' })
export class WebCryptoKeyStorageProvider extends KeyStorageProvider {
  private readonly DB_NAME = 'wallet-key-storage';
  private readonly STORE_NAME = 'keys';
  private readonly DB_VERSION = 1;

  private readonly LOG_PREFIX = '[WebCryptoKeyStorageProvider]';

  public storageMode: BrowserKeyStorageMode | null = null;
  private compatibilityCheckPromise: Promise<BrowserKeyStorageMode> | null = null;

  // Cache is always used; in "in-memory" it's the only storage
  private readonly keyCache = new Map<string, CachedKeyEntry>();
  private readonly kidToKeyId = new Map<string, string>();

  constructor() {
    super();
  }

  public checkBrowserCompatibility(): Promise<BrowserKeyStorageMode> {
    console.log(`${this.LOG_PREFIX} checkBrowserCompatibility()`, {
      storageMode: this.storageMode,
      hasPendingPromise: !!this.compatibilityCheckPromise,
    });

    if (this.storageMode !== null) {
      console.log(`${this.LOG_PREFIX} Using cached storageMode`, { storageMode: this.storageMode });
      return Promise.resolve(this.storageMode);
    }

    this.compatibilityCheckPromise ??= this.checkCompatibilityInternal()
      .then((mode) => {
        console.log(`${this.LOG_PREFIX} Compatibility resolved`, { mode });
        return mode;
      })
      .catch((e) => {
        this.compatibilityCheckPromise = null;
        console.error(`${this.LOG_PREFIX} Compatibility check FAILED`, e);

        if (e instanceof AppError) throw e;

        throw new AppError('Browser compatibility check failed', {
          cause: e,
          translationKey: 'errors.browser-compatibility-check-failed',
        });
      });

    return this.compatibilityCheckPromise;
  }

  private async checkCompatibilityInternal(): Promise<BrowserKeyStorageMode> {

    const hasSecureContext = this.checkSecureContext();
    const hasSubtle = this.checkWebCrypto();
    const hasIndexedDb = this.checkIndexedDB();

    console.log(`${this.LOG_PREFIX} Environment`, { hasSecureContext, hasSubtle, hasIndexedDb });

    if (!hasSecureContext || !hasSubtle) {
      this.storageMode = 'unavailable';
      console.warn(`${this.LOG_PREFIX} Mode=unavailable (secureContext/webcrypto missing)`, {
        hasSecureContext,
        hasSubtle,
      });
      return 'unavailable';
    }

    if (!hasIndexedDb) {
      this.storageMode = 'in-memory';
      console.warn(`${this.LOG_PREFIX} Mode=in-memory (IndexedDB missing)`);
      return 'in-memory';
    }

    const idbOk = await this.testIndexedDBUsable();
    if (!idbOk) {
      this.storageMode = 'in-memory';
      console.warn(`${this.LOG_PREFIX} Mode=in-memory (IndexedDB unusable)`);
      return 'in-memory';
    }

    const cryptoKeyPersistOk = await this.selfTestFullPersistence();
    const mode: BrowserKeyStorageMode = cryptoKeyPersistOk ? 'full' : 'in-memory';
    this.storageMode = mode;

    console.log(`${this.LOG_PREFIX} Mode decision`, { mode, cryptoKeyPersistOk });

    return mode;
  }

  // ---------- Main operations ----------

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    const mode = await this.requireAvailableMode();

    console.log(`${this.LOG_PREFIX} generateKeyPair()`, { algorithm, keyId, mode });

    const params = this.getAlgorithmParams(algorithm);

    const keyPair = await globalThis.crypto.subtle.generateKey(
      params.algorithm,
      false, // extractable = false
      params.usages
    );

    const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const kid = await this.computeJwkThumbprint(publicKeyJwk);
    console.log("Generated key pair with kid:", kid);
    const createdAt = new Date().toISOString();

    const cacheEntry: CachedKeyEntry = {
      keyId,
      kid,
      algorithm,
      createdAt,
      publicKeyJwk,
      privateKey: keyPair.privateKey,
      publicKey: keyPair.publicKey,
    };
    this.keyCache.set(keyId, cacheEntry);
    this.kidToKeyId.set(kid, keyId);

    console.log(`${this.LOG_PREFIX} Cached key material`, {
      keyId,
      kid,
      mode,
      cacheSize: this.keyCache.size,
    });

    if (mode === 'full') {
      const record: StoredFullKeyRecord = {
        keyId,
        algorithm,
        publicKeyJwk,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        kid,
        createdAt,
      };

      await this.saveKeyRecordInternal(record);
      console.log(`${this.LOG_PREFIX} Persisted key to IndexedDB (full mode)`, { keyId, kid });
    } else {
      console.warn(`${this.LOG_PREFIX} Skipping IndexedDB persistence (in-memory mode)`, { keyId, kid });
    }

    return { keyId, algorithm, publicKeyJwk, kid, createdAt };
  }

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    const mode = await this.requireAvailableMode();

    console.log(`${this.LOG_PREFIX} sign()`, {
      keyId,
      mode,
      dataLen: data?.length,
      cacheHit: this.keyCache.has(keyId),
    });

    const cached = this.keyCache.get(keyId);
    if (cached?.privateKey) {
      const params = this.getSignatureParams(cached.algorithm);
      const signature = await globalThis.crypto.subtle.sign(params, cached.privateKey, new Uint8Array(data));
      return new Uint8Array(signature);
    }

    if (mode !== 'full') {
      throw new AppError('Private key is not available in this browser session', {
        translationKey: 'errors.private-key-not-available',
      });
    }

    const record = await this.getKeyRecordFromIndexedDB(keyId);
    if (!record || !isFullRecord(record)) {
      throw new AppError(`Signing key not found for keyId=${keyId}`, {
        translationKey: 'errors.signing-key-not-found',
      });
    }

    this.upsertCacheFromRecord(record);

    const params = this.getSignatureParams(record.algorithm);
    const sig = await globalThis.crypto.subtle.sign(params, record.privateKey, new Uint8Array(data));
    return new Uint8Array(sig);
  }

  async resolveKeyIdByKid(kid: string): Promise<string | null> {
    const mode = await this.requireAvailableMode();

    const cachedKeyId = this.kidToKeyId.get(kid);
    console.log(`${this.LOG_PREFIX} resolveKeyIdByKid()`, {
      kid,
      mode,
      cacheHit: !!cachedKeyId,
    });

    console.log("[DEBUG] Current kidToKeyId map:", Array.from(this.kidToKeyId.entries()));
    if (cachedKeyId) return cachedKeyId;

    if (mode !== 'full') return null;

    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      if (!store.indexNames.contains('kid')) {
        throw new AppError("The browser storage schema is missing the 'kid' index.", {
          translationKey: 'errors.browser-storage-operation-failed',
        });
      }

      const idx = store.index('kid');
      const record = (await this.wrapRequest(idx.get(kid))) as StoredAnyKeyRecord | undefined;
      console.log("[DEBUG] IndexedDB lookup result for kid:", { kid, record });

      await this.awaitTx(tx);

      if (!record) return null;

      this.kidToKeyId.set(kid, record.keyId);

      if (isFullRecord(record)) {
        this.upsertCacheFromRecord(record);
      } else {
        this.keyCache.set(record.keyId, {
          keyId: record.keyId,
          kid: record.kid,
          algorithm: record.algorithm,
          createdAt: record.createdAt,
          publicKeyJwk: record.publicKeyJwk,
        });
      }

      return record.keyId;
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  async hasKey(keyId: string): Promise<boolean> {
    const mode = await this.requireAvailableMode();
    if (this.keyCache.has(keyId)) return true;
    if (mode !== 'full') return false;
    return (await this.getKeyRecordFromIndexedDB(keyId)) !== null;
  }

  async listKeys(): Promise<KeyInfo[]> {
    const mode = await this.requireAvailableMode();

    if (mode !== 'full') {
      console.log(`${this.LOG_PREFIX} listKeys(): in-memory`, { count: this.keyCache.size });
      return Array.from(this.keyCache.values()).map((e) => ({
        keyId: e.keyId,
        algorithm: e.algorithm,
        createdAt: e.createdAt,
      }));
    }

    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const records = (await this.wrapRequest(store.getAll())) as StoredAnyKeyRecord[];
      await this.awaitTx(tx);

      for (const r of records) {
        if (isFullRecord(r)) this.upsertCacheFromRecord(r);
        else {
          this.keyCache.set(r.keyId, {
            keyId: r.keyId,
            kid: r.kid,
            algorithm: r.algorithm,
            createdAt: r.createdAt,
            publicKeyJwk: r.publicKeyJwk,
          });
          this.kidToKeyId.set(r.kid, r.keyId);
        }
      }

      return records.map((r) => ({
        keyId: r.keyId,
        algorithm: r.algorithm,
        createdAt: r.createdAt,
      }));
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  async deleteKey(keyId: string): Promise<void> {
    const mode = await this.requireAvailableMode();

    const cached = this.keyCache.get(keyId);
    if (cached) this.kidToKeyId.delete(cached.kid);
    this.keyCache.delete(keyId);

    console.log(`${this.LOG_PREFIX} deleteKey(): cache cleared`, { keyId, mode });

    if (mode !== 'full') return;

    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      await this.wrapRequest(store.delete(keyId));
      await this.awaitTx(tx);

      console.log(`${this.LOG_PREFIX} deleteKey(): deleted from IndexedDB`, { keyId });
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  // ---------- Public helper used by your flows ----------

  public async computeJwkThumbprint(jwk: JsonWebKey): Promise<string> {
    const crv = jwk.crv;
    const kty = jwk.kty;
    const x = jwk.x;
    const y = jwk.y;

    if (!crv || !kty || !x || !y) {
      throw new AppError('Invalid EC public JWK: missing required parameters (crv, kty, x, y).', {
        translationKey: 'errors.invalid-public-jwk',
      });
    }

    const thumbprintInput = JSON.stringify({ crv, kty, x, y });

    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(thumbprintInput));
    const thumbprint = base64UrlEncode(new Uint8Array(digest));
    console.log("Computed JWK thumbprint digest (base64url):", thumbprint);
    return thumbprint;
  }

  public async isCnfBoundToPublicKey(unparsedCnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    const cnf = unparsedCnf as any;
    if (!cnf) return false;

    const proofThumbprint = await this.computeJwkThumbprint(publicKeyJwk);

    if (cnf.jwk) {
      const cnfThumbprint = await this.computeJwkThumbprint(cnf.jwk as JsonWebKey);
      return cnfThumbprint === proofThumbprint;
    }

    return false;
  }

  // ---------- Mode gating ----------

  private async requireAvailableMode(): Promise<AvailableBrowserKeyStorageMode> {
    const mode = await this.checkBrowserCompatibility();

    if (mode === 'unavailable') {
      throw new AppError('Key storage is unavailable in this environment', {
        translationKey: 'errors.key-storage-unavailable',
      });
    }

    return mode;
  }

  // ---------- Crypto params ----------

  private getAlgorithmParams(algorithm: RawKeyAlgorithm): AlgorithmParams {
    if (algorithm === 'ES256') {
      return {
        algorithm: { name: 'ECDSA', namedCurve: 'P-256' },
        usages: ['sign', 'verify'],
      };
    }

    throw new AppError(`Unsupported algorithm: ${algorithm}`, {
      translationKey: 'errors.unsupported-algorithm',
    });
  }

  private getSignatureParams(algorithm: RawKeyAlgorithm): EcdsaParams {
    if (algorithm === 'ES256') {
      return { name: 'ECDSA', hash: 'SHA-256' };
    }

    throw new AppError(`Unsupported algorithm: ${algorithm}`, {
      translationKey: 'errors.unsupported-algorithm',
    });
  }

  // ---------- IndexedDB internals (used only in full mode and checks) ----------

  private async getKeyRecordFromIndexedDB(keyId: string): Promise<StoredAnyKeyRecord | null> {
    const db = await this.openDatabase();

    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const record = (await this.wrapRequest(store.get(keyId))) as StoredAnyKeyRecord | undefined;
      await this.awaitTx(tx);

      return record ?? null;
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  private async saveKeyRecordInternal(record: StoredAnyKeyRecord): Promise<void> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);

    try {
      await this.wrapRequest(store.put(record));
      await this.awaitTx(tx);
    } catch (e: unknown) {
      if (this.isQuotaExceededError(e)) {
        throw new AppError('Browser storage quota exceeded', {
          cause: e,
          translationKey: 'errors.browser-storage-full',
        });
      }

      throw new AppError('Browser storage operation failed', {
        cause: e,
        translationKey: 'errors.browser-storage-operation-failed',
      });
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }
    }
  }

  private upsertCacheFromRecord(record: StoredFullKeyRecord): void {
    this.keyCache.set(record.keyId, {
      keyId: record.keyId,
      kid: record.kid,
      algorithm: record.algorithm,
      createdAt: record.createdAt,
      publicKeyJwk: record.publicKeyJwk,
      privateKey: record.privateKey,
      publicKey: record.publicKey,
    });
    this.kidToKeyId.set(record.kid, record.keyId);
  }

  private async testIndexedDBUsable(): Promise<boolean> {
    if (!this.checkIndexedDB()) return false;

    let db: IDBDatabase | null = null;

    try {
      db = await this.openDatabase();

      const tx = db.transaction(this.STORE_NAME, 'readonly');
      tx.objectStore(this.STORE_NAME).get('__idb_smoke__');
      await this.awaitTx(tx);

      console.log(`${this.LOG_PREFIX} IndexedDB smoke test OK`);
      return true;
    } catch (e) {
      console.warn(`${this.LOG_PREFIX} IndexedDB smoke test FAILED`, e);
      return false;
    } finally {
      try {
        db?.close();
      } catch {
        // ignore
      }
    }
  }

  private async selfTestFullPersistence(): Promise<boolean> {
    const testKeyId = `__compat_test__${globalThis.crypto.randomUUID?.() ?? String(Date.now())}`;
    let saved = false;

    try {
      const params = this.getAlgorithmParams('ES256');
      const keyPair = await globalThis.crypto.subtle.generateKey(params.algorithm, false, params.usages);

      const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);

      const record: StoredFullKeyRecord = {
        keyId: testKeyId,
        algorithm: 'ES256',
        publicKeyJwk,
        privateKey: keyPair.privateKey,
        publicKey: keyPair.publicKey,
        kid: 'compat-test',
        createdAt: new Date().toISOString(),
      };

      console.log(`${this.LOG_PREFIX} Full persistence self-test: store CryptoKey`);

      await this.saveKeyRecordInternal(record);
      saved = true;

      const loaded = await this.getKeyRecordFromIndexedDB(testKeyId);
      if (!loaded || !isFullRecord(loaded)) {
        console.warn(`${this.LOG_PREFIX} Full persistence self-test: record not full after load`);
        return false;
      }

      const data = new TextEncoder().encode('compat');
      const sig = await globalThis.crypto.subtle.sign(this.getSignatureParams('ES256'), loaded.privateKey, data);
      const ok = await globalThis.crypto.subtle.verify(
        this.getSignatureParams('ES256'),
        loaded.publicKey,
        sig,
        data
      );

      console.log(`${this.LOG_PREFIX} Full persistence self-test result`, { ok });
      return ok;
    } catch (e) {
      console.warn(`${this.LOG_PREFIX} Full persistence self-test FAILED`, e);
      return false;
    } finally {
      if (saved) {
        try {
          await this.deleteKey(testKeyId);
        } catch {
          // ignore
        }
      }
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    if (!this.checkIndexedDB()) {
      throw new AppError('IndexedDB is unavailable in this environment.', {
        translationKey: 'errors.key-storage-unavailable',
      });
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => {
        const cause = request.error ?? new Error('IndexedDB open request failed.');
        reject(
          new AppError('Could not open IndexedDB database', {
            cause,
            translationKey: 'errors.secure-storage-open-failed',
          })
        );
      };

      request.onblocked = () => {
        reject(
          new AppError('IndexedDB upgrade blocked by another tab', {
            translationKey: 'errors.secure-storage-blocked-by-another-tab',
          })
        );
      };

      request.onsuccess = () => {
        const db = request.result;

        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            // ignore
          }
        };

        resolve(db);
      };

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

  private wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);

      req.onerror = () => {
        const raw: unknown = req.error;

        if (raw instanceof Error) {
          reject(raw);
          return;
        }

        if (typeof raw === 'string') {
          reject(new Error(raw));
          return;
        }

        reject(new Error('IndexedDB request failed'));
      };
    });
  }

  private awaitTx(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();

      tx.onerror = () => {
        reject(
          new AppError('IndexedDB transaction failed', {
            cause: tx.error,
            translationKey: 'errors.browser-storage-operation-failed',
          })
        );
      };

      tx.onabort = () => {
        reject(
          new AppError('IndexedDB transaction aborted', {
            cause: tx.error,
            translationKey: 'errors.browser-storage-operation-failed',
          })
        );
      };
    });
  }

  private checkIndexedDB(): boolean {
    return !!globalThis.indexedDB;
  }

  private checkWebCrypto(): boolean {
    return !!globalThis.crypto?.subtle;
  }

  private checkSecureContext(): boolean {
    const isc = (globalThis as any).isSecureContext;
    if (typeof isc === 'boolean') return isc;

    if (typeof location === 'undefined') return false;

    const protocolOk = location.protocol === 'https:';
    const host = location.hostname;
    const localhostOk = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';

    return protocolOk || localhostOk;
  }

  private isQuotaExceededError(e: unknown): boolean {
    const anyErr = e as any;
    const name = String(anyErr?.name ?? '');
    const message = String(anyErr?.message ?? '');

    return (
      name === 'QuotaExceededError' ||
      name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      /quota/i.test(name) ||
      /quota/i.test(message)
    );
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
  const chunkSize = 0x2000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCodePoint(...chunk);
  }

  return btoa(binary);
}