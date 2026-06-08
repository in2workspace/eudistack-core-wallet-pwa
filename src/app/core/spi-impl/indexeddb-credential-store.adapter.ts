import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';
import {VerifiableCredential} from "../models/verifiable-credential";

@Injectable({
  providedIn: 'root'
})
export class IndexedDbCredentialStoreAdapter {

  private storageReady: Promise<void>;

  constructor(private storage: Storage) {
    this.storageReady = this.initStorage();
  }

  private async initStorage(): Promise<void> {
    await this.storage.create();
  }

  async setDomeRecoveryCompleted(status: boolean): Promise<void> {
    await this.storageReady; // Esperamos a que la BBDD esté lista
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

  async saveCredentials(newCredentials: VerifiableCredential[]): Promise<void> {
    await this.storageReady;

    let currentCredentials: VerifiableCredential[] = await this.storage.get('credentials');

    if (!currentCredentials || !Array.isArray(currentCredentials)) {
      currentCredentials = [];
    }

    for (const newCred of newCredentials) {
      const existingIndex = currentCredentials.findIndex(c => c.id === newCred.id);

      if (existingIndex >= 0) {
        currentCredentials[existingIndex] = newCred;
      } else {
        currentCredentials.push(newCred);
      }
    }
    await this.storage.set('credentials', currentCredentials);
    console.log(`[IndexedDB Adapter] Saved ${newCredentials.length} credentials.`);
  }
}
