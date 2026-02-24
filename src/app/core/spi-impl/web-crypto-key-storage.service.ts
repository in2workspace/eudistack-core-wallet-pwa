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

type AvailableBrowserKeyStorageMode = 'full' | 'public-only';
type BrowserKeyStorageMode = AvailableBrowserKeyStorageMode | 'unavailable';

@Injectable({ providedIn: 'root' })
export class WebCryptoKeyStorageProvider extends KeyStorageProvider {
  private readonly DB_NAME = 'wallet-key-storage';
  private readonly STORE_NAME = 'keys';
  private readonly DB_VERSION = 1;

  public storageMode: BrowserKeyStorageMode | null = null;
  private compatibilityCheckPromise: Promise<BrowserKeyStorageMode> | null = null;
  private readonly keyCache = new Map<string, { privateKey?: CryptoKey; publicKey?: CryptoKey }>();

  constructor() {
    super();
  }

  public checkBrowserCompatibility(): Promise<BrowserKeyStorageMode> {
    console.log('Checking browser compatibility for WebCryptoKeyStorageProvider. Current storageMode:', this.storageMode);

    if (this.storageMode !== null) {
      return Promise.resolve(this.storageMode);
    }

    this.compatibilityCheckPromise ??= this.checkCompatibilityInternal().catch((e) => {
      this.compatibilityCheckPromise = null;

      if (e instanceof AppError) throw e;

      throw new AppError('Browser compatibility check failed', {
        cause: e,
        translationKey: 'errors.browser-compatibility-check-failed',
      });
    });

    return this.compatibilityCheckPromise;
  }

  private async checkCompatibilityInternal(): Promise<BrowserKeyStorageMode> {
    //todo if crypto is available but not IDB, set 'memory-only' mode
    if (!this.checkCryptoAndIndexedDBAvailability()) {
      this.storageMode = 'unavailable';
      console.warn('Web Crypto API or IndexedDB is not available. Key storage functionality will be unavailable.');
      return 'unavailable';
    }

    const idbOk = await this.testIndexedDBUsable();
    if (!idbOk) {
      this.storageMode = 'unavailable';
      console.warn('IndexedDB smoke test failed. Key storage functionality will be unavailable.');
      return 'unavailable';
    }

    const mode = await this.runCompatibilityCheckOnce();
    this.storageMode = mode;
    return mode;
  }

  private checkCryptoAndIndexedDBAvailability(): boolean {
    const hasSecureContext = this.checkSecureContext();
    const hasSubtle = this.checkWebCrypto();
    const hasIndexedDb = this.checkIndexedDB();

    const isAvailable = hasSecureContext && hasSubtle && hasIndexedDb;
    if (isAvailable) {
      return true;
    }

    console.error('[WebCryptoKeyStorageProvider] Unavailable environment:', {
      hasSecureContext,
      hasSubtle,
      hasIndexedDb,
    });

    this.storageMode = 'unavailable';
    return false;
  }

  private async runCompatibilityCheckOnce(): Promise<BrowserKeyStorageMode> {
    return await this.selfTestStorageMode();
  }

  private async testIndexedDBUsable(): Promise<boolean> {
    if (!this.checkIndexedDB()) {
      console.warn(
        'IndexedDB is not accessible. Check browser settings (private mode, storage permissions) and try again'
      );
      return false;
    }

    let db: IDBDatabase | null = null;

    try {
      db = await this.openDatabase();

      const tx = db.transaction(this.STORE_NAME, 'readonly');
      tx.objectStore(this.STORE_NAME).get('__idb_smoke__');
      await this.awaitTx(tx);

      return true;
    } catch (e) {
      console.error('[WebCryptoKeyStorageProvider] IndexedDB smoke test failed:', e);
      return false;
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore close failures.
      }
    }
  }

  private async selfTestStorageMode(): Promise<BrowserKeyStorageMode> {
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

      // Force "full" mode for the test write.
      // If IndexedDB can't clone CryptoKey, this will throw.
      await this.saveKeyRecordInternal(record, 'full');
      saved = true;

      const loadedKeyRecord = await this.getKeyRecord(testKeyId);
      if (!loadedKeyRecord || !isFullRecord(loadedKeyRecord)) return 'public-only';

      // Validate that recovered keys are usable.
      const data = new TextEncoder().encode('compat');
      const sig = await globalThis.crypto.subtle.sign(this.getSignatureParams('ES256'), loadedKeyRecord.privateKey, data);

      const ok = await globalThis.crypto.subtle.verify(
        this.getSignatureParams('ES256'),
        loadedKeyRecord.publicKey,
        sig,
        data
      );
      const result = ok ? 'full' : 'public-only';
      console.log('Self-test signature verification result:', result);
      return result;
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
    await this.requireAvailableMode();

    const params = this.getAlgorithmParams(algorithm);
    console.log('Generating key pair with params:', params);

    // Generate NON-EXTRACTABLE key pair (critical).
    // We assume it is a key pair because currently only ECDSA is supported (with symmetric algorithms only one is returned).
    const keyPair = await globalThis.crypto.subtle.generateKey(
      params.algorithm,
      false, // extractable = false
      params.usages
    );
    console.log('Key pair generated:', keyPair);
    this.keyCache.set(keyId, { privateKey: keyPair.privateKey, publicKey: keyPair.publicKey });

    const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);

    // Compute kid as JWK thumbprint (RFC 7638).
    const kid = await this.computeJwkThumbprint(publicKeyJwk);

    const createdAt = new Date().toISOString();

    const record: StoredFullKeyRecord = {
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
    await this.requireAvailableMode();

    const record = await this.getKeyRecord(keyId);
    if (!record) {
      throw new AppError(`Signing key not found for keyId=${keyId}`, {
        translationKey: 'errors.signing-key-not-found',
      });
    }

    const params = this.getSignatureParams(record.algorithm);

    const cachedPrivateKey = this.keyCache.get(keyId)?.privateKey;
    let privateKey: CryptoKey | undefined = cachedPrivateKey;

    if (!privateKey && this.storageMode === 'full' && isFullRecord(record)) {
      privateKey = record.privateKey;
    }

    if (!privateKey) {
      throw new AppError('Private key is not available in this browser session', {
        translationKey: 'errors.private-key-not-available',
      });
    }

    const signature = await globalThis.crypto.subtle.sign(params, privateKey, new Uint8Array(data));
    return new Uint8Array(signature);
  }

  public async isCnfBoundToPublicKey(unparsedCnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    console.log('Validating if cnf matches public key. Unparsed cnf:');
    console.log(unparsedCnf);
    console.log('Public key JWK:');
    console.log(publicKeyJwk);

    const cnf = unparsedCnf as any;
    if (!cnf) return false;

    const proofThumbprint = await this.computeJwkThumbprint(publicKeyJwk);
    console.log('proofThumbprint: ' + proofThumbprint);

    if (cnf.jwk) {
      const cnfThumbprint = await this.computeJwkThumbprint(cnf.jwk as JsonWebKey);
      console.log('CNF thumprint: ' + cnfThumbprint);
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
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      const store = tx.objectStore(this.STORE_NAME);

      await this.wrapRequest(store.delete(keyId));
      await this.awaitTx(tx);
      this.keyCache.delete(keyId);
    } finally {
      try {
        db.close();
      } catch {}
    }
  }

  async listKeys(): Promise<KeyInfo[]> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const records = (await this.wrapRequest(store.getAll())) as StoredAnyKeyRecord[];
      await this.awaitTx(tx);
      return records.map((r) => ({
        keyId: r.keyId,
        algorithm: r.algorithm,
        createdAt: r.createdAt,
      }));
    } finally {
      db.close();
    }
  }

  // --- Optional backup methods (Enterprise) ---

  async exportKey(keyId: string): Promise<JsonWebKey> {
    await this.requireAvailableMode();

    const record = await this.getKeyRecord(keyId);
    if (!record) {
      throw new AppError(`Key not found: ${keyId}`, {
        translationKey: 'errors.key-not-found',
      });
    }

    const privateKey = isFullRecord(record) ? record.privateKey : this.keyCache.get(keyId)?.privateKey;

    if (!privateKey) {
      throw new AppError('Private key is not available in this browser session.', {
        translationKey: 'errors.private-key-not-available',
      });
    }

    try {
      return await globalThis.crypto.subtle.exportKey('jwk', privateKey);
    } catch (e: unknown) {
      throw new AppError('This private key is non-extractable and cannot be exported.', {
        cause: e,
        translationKey: 'errors.private-key-non-extractable',
      });
    }
  }

  async importKey(keyId: string, jwk: JsonWebKey): Promise<void> {
    await this.requireAvailableMode();

    const algorithm = this.jwkToAlgorithm(jwk);
    const params = this.getAlgorithmParams(algorithm);

    // Import private key as NON-EXTRACTABLE.
    const privateKey = await globalThis.crypto.subtle.importKey('jwk', jwk, params.algorithm, false, ['sign']);

    // Build public JWK (remove private component).
    const publicKeyJwk: JsonWebKey = { ...jwk };
    delete (publicKeyJwk as any).d;

    const publicKey = await globalThis.crypto.subtle.importKey('jwk', publicKeyJwk, params.algorithm, true, ['verify']);

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
      throw new AppError('Invalid EC public JWK: missing required parameters (crv, kty, x, y).', {
        translationKey: 'errors.invalid-public-jwk',
      });
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
      throw new AppError(`Unsupported key type: ${kty ?? 'unknown'}`, {
        translationKey: 'errors.unsupported-key-type',
      });
    }
    if (crv === 'P-256') return 'ES256';
    throw new AppError(`Unsupported curve: ${crv ?? 'unknown'}`, {
      translationKey: 'errors.unsupported-curve',
    });
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
            // Ignore close failures.
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

  private async getKeyRecord(keyId: string): Promise<StoredAnyKeyRecord | null> {
    const db = await this.openDatabase();

    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      const record = (await this.wrapRequest(store.get(keyId))) as StoredAnyKeyRecord | undefined;

      await this.awaitTx(tx);

      if (record && isFullRecord(record) && !this.keyCache.has(keyId)) {
        this.keyCache.set(keyId, { privateKey: record.privateKey, publicKey: record.publicKey });
      }

      return record ?? null;
    } finally {
      try {
        db.close();
      } catch {
        // Ignore close failures.
      }
    }
  }

  private async saveKeyRecord(record: StoredAnyKeyRecord): Promise<void> {
    const mode = await this.requireAvailableMode();
    await this.saveKeyRecordInternal(record, mode);
  }

  private async saveKeyRecordInternal(record: StoredAnyKeyRecord, mode: AvailableBrowserKeyStorageMode): Promise<void> {
    const db = await this.openDatabase();
    const tx = db.transaction(this.STORE_NAME, 'readwrite');
    const store = tx.objectStore(this.STORE_NAME);

    const toPersist: StoredAnyKeyRecord =
      mode === 'public-only'
        ? {
            keyId: record.keyId,
            algorithm: record.algorithm,
            publicKeyJwk: record.publicKeyJwk,
            kid: record.kid,
            createdAt: record.createdAt,
          }
        : record;

    try {
      await this.wrapRequest(store.put(toPersist));
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
      db.close();
    }
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

  async resolveKeyIdByKid(kid: string): Promise<string | null> {
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

      await this.awaitTx(tx);

      return record?.keyId ?? null;
    } finally {
      try {
        db.close();
      } catch {
        // Ignore close failures.
      }
    }
  }

  private async requireAvailableMode(): Promise<AvailableBrowserKeyStorageMode> {
    const mode = await this.checkBrowserCompatibility();

    if (mode === 'unavailable') {
      throw new AppError('Key storage is unavailable in this environment', {
        translationKey: 'errors.key-storage-unavailable',
      });
    }

    return mode;
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

    // Fallback for older/embedded browsers
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