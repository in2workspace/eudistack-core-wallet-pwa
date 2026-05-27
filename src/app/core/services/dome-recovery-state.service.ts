import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DomeRecoveryStateService {

  recoveryInProgress = signal<boolean>(false);
  recoveryCompleted = signal<boolean>(false);
  recoveryError = signal<string | null>(null);

  private readonly DB_NAME = 'DomeWalletDB';
  private readonly STORE_NAME = 'RecoveryState';

  constructor() {
    this.initDatabase();
  }

  setRecoveryInProgress(status: boolean) { this.recoveryInProgress.set(status); }

  setDomeRecoveryCompleted(status: boolean) {
    this.recoveryCompleted.set(status);
    this.saveToIndexedDB('recoveryCompleted', status);
  }

  getDomeRecoveryCompleted(): boolean {
    return this.recoveryCompleted();
  }

  setDomeIdempotencyKey(key: string) {
    this.saveToIndexedDB('idempotencyKey', key);
  }

  async getDomeIdempotencyKey(): Promise<string | null> {
    return await this.getFromIndexedDB('idempotencyKey');
  }

  private async initDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async saveToIndexedDB(key: string, value: any): Promise<void> {
    const db = await this.initDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      tx.objectStore(this.STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
    });
  }

  private async getFromIndexedDB(key: string): Promise<any> {
    const db = await this.initDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(this.STORE_NAME, 'readonly');
      const request = tx.objectStore(this.STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
    });
  }
}
