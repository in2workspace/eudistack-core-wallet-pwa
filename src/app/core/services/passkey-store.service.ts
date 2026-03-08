import { Injectable } from '@angular/core';
import { AppError } from '../models/error/AppError';

const DB_NAME = 'wallet-passkey-store';
const STORE_NAME = 'config';
const DB_VERSION = 1;

const KEY_CREDENTIAL_ID = 'credential_id';
const KEY_HAS_PASSKEY = 'has_passkey';

/**
 * Persists passkey metadata (credential ID and presence flag) in IndexedDB.
 *
 * IndexedDB survives hard reloads and is more resilient than localStorage
 * to accidental data clearing. An in-memory cache is loaded during init()
 * so that reads remain synchronous for guards and route resolvers.
 *
 * Must be initialised via APP_INITIALIZER before routing starts.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyStoreService {
  private cache = new Map<string, unknown>();

  // --- Sync reads (from cache) ---

  hasPasskey(): boolean {
    return this.cache.get(KEY_HAS_PASSKEY) === true;
  }

  getCredentialId(): string | null {
    return (this.cache.get(KEY_CREDENTIAL_ID) as string) ?? null;
  }

  // --- Async writes (persist to IndexedDB + update cache) ---

  async setCredentialId(credentialId: string): Promise<void> {
    this.cache.set(KEY_CREDENTIAL_ID, credentialId);
    this.cache.set(KEY_HAS_PASSKEY, true);
    await this.putAll([
      { key: KEY_CREDENTIAL_ID, value: credentialId },
      { key: KEY_HAS_PASSKEY, value: true },
    ]);
  }

  async setHasPasskey(value: boolean): Promise<void> {
    this.cache.set(KEY_HAS_PASSKEY, value);
    await this.put({ key: KEY_HAS_PASSKEY, value });
  }

  async clear(): Promise<void> {
    this.cache.delete(KEY_CREDENTIAL_ID);
    this.cache.delete(KEY_HAS_PASSKEY);
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  // --- Initialisation (called from APP_INITIALIZER) ---

  async init(): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const records = (await this.wrapRequest(store.getAll())) as Array<{
        key: string;
        value: unknown;
      }>;
      await this.awaitTx(tx);

      for (const record of records) {
        this.cache.set(record.key, record.value);
      }

      await this.migrateFromLocalStorage();
    } finally {
      db.close();
    }
  }

  // --- Migration: one-time move from localStorage ---

  private async migrateFromLocalStorage(): Promise<void> {
    const legacyCredentialId = localStorage.getItem('wallet_passkey_credential_id');
    const legacyHasPasskey = localStorage.getItem('wallet_has_passkey');

    if (legacyCredentialId && !this.cache.has(KEY_CREDENTIAL_ID)) {
      await this.setCredentialId(legacyCredentialId);
      localStorage.removeItem('wallet_passkey_credential_id');
      localStorage.removeItem('wallet_has_passkey');
    } else if (legacyHasPasskey && !this.cache.has(KEY_HAS_PASSKEY)) {
      await this.setHasPasskey(legacyHasPasskey === 'true');
      localStorage.removeItem('wallet_has_passkey');
    }
  }

  // --- IndexedDB helpers ---

  private async put(record: { key: string; value: unknown }): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  private async putAll(records: Array<{ key: string; value: unknown }>): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const record of records) {
        store.put(record);
      }
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () =>
        reject(
          new AppError('Could not open passkey store database', {
            cause: request.error ?? undefined,
            translationKey: 'errors.secure-storage-open-failed',
          })
        );

      request.onblocked = () =>
        reject(
          new AppError('IndexedDB upgrade blocked by another tab', {
            translationKey: 'errors.secure-storage-blocked-by-another-tab',
          })
        );

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try { db.close(); } catch { /* ignore */ }
        };
        resolve(db);
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
    });
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
      tx.onerror = () =>
        reject(
          new AppError('IndexedDB transaction failed', {
            cause: tx.error ?? undefined,
            translationKey: 'errors.browser-storage-operation-failed',
          })
        );
      tx.onabort = () =>
        reject(
          new AppError('IndexedDB transaction aborted', {
            cause: tx.error ?? undefined,
            translationKey: 'errors.browser-storage-operation-failed',
          })
        );
    });
  }
}
