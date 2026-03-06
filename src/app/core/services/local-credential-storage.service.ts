import { Injectable } from '@angular/core';
import { AppError } from '../models/error/AppError';
import { VerifiableCredential } from '../models/verifiable-credential';

/**
 * IndexedDB-backed credential storage for browser-only (PRF) mode.
 *
 * Stores full VerifiableCredential objects locally. No backend calls.
 * DB: wallet-credentials, store: credentials, keyPath: id
 */
@Injectable({ providedIn: 'root' })
export class LocalCredentialStorageService {
  private readonly DB_NAME = 'wallet-credentials';
  private readonly STORE_NAME = 'credentials';
  private readonly DB_VERSION = 1;

  async saveCredential(vc: VerifiableCredential): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).put(vc);
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  async getAllCredentials(): Promise<VerifiableCredential[]> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const records = await this.wrapRequest<VerifiableCredential[]>(
        tx.objectStore(this.STORE_NAME).getAll()
      );
      await this.awaitTx(tx);
      return records;
    } finally {
      db.close();
    }
  }

  async findCredentialById(id: string): Promise<VerifiableCredential | null> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const record = await this.wrapRequest<VerifiableCredential | undefined>(
        tx.objectStore(this.STORE_NAME).get(id)
      );
      await this.awaitTx(tx);
      return record ?? null;
    } finally {
      db.close();
    }
  }

  async deleteCredential(id: string): Promise<void> {
    const db = await this.openDatabase();
    try {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).delete(id);
      await this.awaitTx(tx);
    } finally {
      db.close();
    }
  }

  // ---------------------------------------------------------------------------
  // IndexedDB helpers
  // ---------------------------------------------------------------------------

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () =>
        reject(new AppError('Could not open credential database', {
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
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME, { keyPath: 'id' });
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
