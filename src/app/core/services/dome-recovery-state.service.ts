import { Injectable, signal } from '@angular/core';
import { IndexedDbCredentialStoreAdapter } from '../spi-impl/indexeddb-credential-store.adapter';

@Injectable({ providedIn: 'root' })
export class DomeRecoveryStateService {

  recoveryInProgress = signal<boolean>(false);
  recoveryCompleted = signal<boolean>(false);
  recoveryError = signal<string | null>(null);

  private localStore: IndexedDbCredentialStoreAdapter;

  constructor(localStore: IndexedDbCredentialStoreAdapter) {
    this.loadInitialState();
    this.localStore = localStore;
  }

  /**
   * Al inicializar el servicio, lee la base de datos para restaurar
   * el estado de las Signals (Fail-safe check).
   */
  private async loadInitialState() {
    const isCompleted = await this.localStore.getDomeRecoveryCompleted();
    this.recoveryCompleted.set(isCompleted);
  }

  // ==========================================================
  // MÉTODOS DE ESTADO (Actualizan la UI y guardan en BBDD)
  // ==========================================================

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
