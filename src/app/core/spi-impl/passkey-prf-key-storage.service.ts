import { inject, Injectable } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { RawKeyAlgorithm, PublicKeyInfo, KeyInfo, StoredPublicKeyRecord } from '../models/StoredKeyRecord';
import { PasskeyPrfService } from '../services/passkey-prf.service';
import { AppError } from '../models/error/AppError';

/** Regex to detect ephemeral keyIds (UUIDs from DPoP / WIA). */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * KeyStorageProvider implementation backed by WebAuthn PRF extension.
 *
 * - Credential-bound keys: derived deterministically via PRF(passkey, keyId-as-salt).
 *   Only public key metadata is persisted in IndexedDB. Private keys are never stored.
 * - Ephemeral keys (DPoP, WIA): generated via crypto.subtle.generateKey(), kept in-memory only.
 *
 * Each PRF derivation triggers a biometric prompt. An in-memory cache avoids
 * repeated prompts within the same flow (e.g., generateKeyPair → sign).
 */
@Injectable()
export class PasskeyPrfKeyStorageProvider extends KeyStorageProvider {
  private readonly DB_NAME = 'wallet-prf-key-metadata';
  private readonly STORE_NAME = 'keys';
  private readonly DB_VERSION = 1;

  private readonly prfService = inject(PasskeyPrfService);

  /** In-memory cache: keyId → CryptoKey (both PRF-derived and ephemeral). */
  private readonly keyCache = new Map<string, CryptoKey>();

  override async init(): Promise<void> {
    const status = await this.prfService.init();
    if (status === 'unavailable') {
      console.warn('[PasskeyPrfKeyStorageProvider] PRF extension is not available in this environment.');
    }
  }

  async generateKeyPair(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    this.assertES256(algorithm);

    if (this.isEphemeral(keyId)) {
      return this.generateEphemeralKey(algorithm, keyId);
    }

    return this.generatePrfDerivedKey(algorithm, keyId);
  }

  async sign(keyId: string, data: Uint8Array): Promise<Uint8Array> {
    let privateKey = this.keyCache.get(keyId);

    if (!privateKey) {
      if (this.isEphemeral(keyId)) {
        throw new AppError(`Ephemeral key expired or not found: ${keyId}`, {
          translationKey: 'errors.signing-key-not-found',
        });
      }

      // Re-derive via PRF (triggers biometric)
      const salt = new TextEncoder().encode(keyId);
      const derived = await this.prfService.deriveSigningKey(salt);
      privateKey = derived.privateKey;
      this.keyCache.set(keyId, privateKey);
    }

    const signature = await globalThis.crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      new Uint8Array(data)
    );

    return new Uint8Array(signature);
  }

  async hasKey(keyId: string): Promise<boolean> {
    if (this.keyCache.has(keyId)) return true;
    const record = await this.getKeyRecord(keyId);
    return record !== null;
  }

  async deleteKey(keyId: string): Promise<void> {
    this.keyCache.delete(keyId);

    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).delete(keyId);
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  async listKeys(): Promise<KeyInfo[]> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const records = (await this.wrapRequest(
        tx.objectStore(this.STORE_NAME).getAll()
      )) as StoredPublicKeyRecord[];
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

  async isCnfBoundToPublicKey(unparsedCnf: unknown, publicKeyJwk: JsonWebKey): Promise<boolean> {
    const cnf = unparsedCnf as any;
    if (!cnf?.jwk) return false;

    const proofThumbprint = await this.computeJwkThumbprint(publicKeyJwk);
    const cnfThumbprint = await this.computeJwkThumbprint(cnf.jwk as JsonWebKey);
    return cnfThumbprint === proofThumbprint;
  }

  async resolveKeyIdByKid(kid: string): Promise<string | null> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const store = tx.objectStore(this.STORE_NAME);

      if (!store.indexNames.contains('kid')) return null;

      const record = (await this.wrapRequest(
        store.index('kid').get(kid)
      )) as StoredPublicKeyRecord | undefined;
      await this.awaitTx(tx);

      return record?.keyId ?? null;
    } finally {
      db.close();
    }
  }

  // --- Not supported for PRF mode ---

  async exportKey(_keyId: string): Promise<JsonWebKey> {
    throw new AppError('Key export is not supported in PRF mode — keys are derived, not stored.', {
      translationKey: 'errors.operation-not-supported',
    });
  }

  async importKey(_keyId: string, _jwk: JsonWebKey): Promise<void> {
    throw new AppError('Key import is not supported in PRF mode — keys are derived, not stored.', {
      translationKey: 'errors.operation-not-supported',
    });
  }

  // ---------------------------------------------------------------------------
  // Private: key generation strategies
  // ---------------------------------------------------------------------------

  private async generatePrfDerivedKey(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    const salt = new TextEncoder().encode(keyId);
    const { privateKey, publicKeyJwk } = await this.prfService.deriveSigningKey(salt);

    this.keyCache.set(keyId, privateKey);

    const kid = await this.computeJwkThumbprint(publicKeyJwk);
    const createdAt = new Date().toISOString();

    const record: StoredPublicKeyRecord = {
      keyId,
      algorithm,
      publicKeyJwk,
      kid,
      createdAt,
    };

    await this.saveKeyRecord(record);

    return { keyId, algorithm, publicKeyJwk, kid, createdAt };
  }

  private async generateEphemeralKey(algorithm: RawKeyAlgorithm, keyId: string): Promise<PublicKeyInfo> {
    const keyPair = await globalThis.crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );

    this.keyCache.set(keyId, keyPair.privateKey);

    const publicKeyJwk = await globalThis.crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const kid = await this.computeJwkThumbprint(publicKeyJwk);
    const createdAt = new Date().toISOString();

    // Ephemeral keys are NOT persisted to IndexedDB.
    return { keyId, algorithm, publicKeyJwk, kid, createdAt };
  }

  // ---------------------------------------------------------------------------
  // Private: IndexedDB helpers
  // ---------------------------------------------------------------------------

  private isEphemeral(keyId: string): boolean {
    return UUID_PATTERN.test(keyId);
  }

  private assertES256(algorithm: RawKeyAlgorithm): void {
    if (algorithm !== 'ES256') {
      throw new AppError(`Unsupported algorithm: ${algorithm}`, {
        translationKey: 'errors.unsupported-algorithm',
      });
    }
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () =>
        reject(new AppError('Could not open PRF key metadata database', {
          cause: request.error ?? undefined,
          translationKey: 'errors.secure-storage-open-failed',
        }));

      request.onblocked = () =>
        reject(new AppError('IndexedDB upgrade blocked by another tab', {
          translationKey: 'errors.secure-storage-blocked-by-another-tab',
        }));

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } };
        resolve(db);
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        const tx = request.transaction;
        if (!tx) throw new Error('IndexedDB upgrade transaction not available.');

        const store = db.objectStoreNames.contains(this.STORE_NAME)
          ? tx.objectStore(this.STORE_NAME)
          : db.createObjectStore(this.STORE_NAME, { keyPath: 'keyId' });

        if (!store.indexNames.contains('kid')) {
          store.createIndex('kid', 'kid', { unique: true });
        }
      };
    });
  }

  private async getKeyRecord(keyId: string): Promise<StoredPublicKeyRecord | null> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const record = (await this.wrapRequest(
        tx.objectStore(this.STORE_NAME).get(keyId)
      )) as StoredPublicKeyRecord | undefined;
      await this.awaitTx(tx);
      return record ?? null;
    } finally {
      db.close();
    }
  }

  private async saveKeyRecord(record: StoredPublicKeyRecord): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).put(record);
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  private wrapRequest<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  }

  private awaitTx(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new AppError('IndexedDB transaction failed', {
        cause: tx.error ?? undefined,
        translationKey: 'errors.browser-storage-operation-failed',
      }));
      tx.onabort = () => reject(new AppError('IndexedDB transaction aborted', {
        cause: tx.error ?? undefined,
        translationKey: 'errors.browser-storage-operation-failed',
      }));
    });
  }
}
