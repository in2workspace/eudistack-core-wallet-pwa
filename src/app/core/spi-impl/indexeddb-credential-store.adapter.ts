import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import {VerifiableCredential} from "../models/verifiable-credential";
import {LocalCredentialStorageService} from "../services/local-credential-storage.service";

@Injectable({
  providedIn: 'root'
})
export class IndexedDbCredentialStoreAdapter {

  private storageReady: Promise<void>;

  constructor(
    private storage: Storage,
    private credentialStorage: LocalCredentialStorageService
  ) {
    this.storageReady = this.initStorage();
  }

  private async initStorage(): Promise<void> {
    await this.storage.create();
  }

  async setDomeRecoveryCompleted(status: boolean): Promise<void> {
    await this.storageReady;
    await this.storage.set('dome_recovery_completed', status);
  }

  async getDomeRecoveryCompleted(): Promise<boolean> {
    await this.storageReady;
    const status = await this.storage.get('dome_recovery_completed');
    return status === true;
  }

  async setDomeIdempotencyKey(key: string): Promise<void> {
    await this.storageReady;
    await this.storage.set('dome_idempotency_key', key);
  }

  async getDomeIdempotencyKey(): Promise<string | null> {
    await this.storageReady;
    return await this.storage.get('dome_idempotency_key');
  }

  /**
   * Persists credentials into the wallet IndexedDB store.
   * LocalCredentialStorageService already performs UPSERT operations
   * using the credential id as the primary key.
   */
  async saveCredentials(newCredentials: VerifiableCredential[]): Promise<void> {
    if (!newCredentials?.length) {
      return;
    }

    for (const credential of newCredentials) {
      await this.credentialStorage.saveCredential(credential);
    }

    console.log(
      `[IndexedDB Adapter] Saved ${newCredentials.length} credentials.`
    );
  }
}
