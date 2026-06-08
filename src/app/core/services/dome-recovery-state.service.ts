import { Injectable, signal } from '@angular/core';
import { IndexedDbCredentialStoreAdapter } from '../spi-impl/indexeddb-credential-store.adapter';

@Injectable({ providedIn: 'root' })
export class DomeRecoveryStateService {

  readonly recoveryInProgress = signal<boolean>(false);
  readonly recoveryCompleted = signal<boolean>(false);
  readonly recoveryError = signal<string | null>(null);

  constructor(
    private readonly localStore: IndexedDbCredentialStoreAdapter) {
    this.loadInitialState();
  }

  private async loadInitialState() {
    const isCompleted = await this.localStore.getDomeRecoveryCompleted();
    this.recoveryCompleted.set(isCompleted);
  }

  setRecoveryInProgress(status: boolean) {
    this.recoveryInProgress.set(status);
  }

  async setDomeRecoveryCompleted(status: boolean) {
    this.recoveryCompleted.set(status);
    await this.localStore.setDomeRecoveryCompleted(status);
  }

  getDomeRecoveryCompleted(): boolean {
    return this.recoveryCompleted();
  }

  async setDomeIdempotencyKey(key: string) {
    await this.localStore.setDomeIdempotencyKey(key);
  }

  async getDomeIdempotencyKey(): Promise<string | null> {
    return await this.localStore.getDomeIdempotencyKey();
  }
}
