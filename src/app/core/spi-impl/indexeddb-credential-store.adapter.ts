import { Injectable } from '@angular/core';
import { Storage } from '@ionic/storage-angular';

@Injectable({
  providedIn: 'root'
})
export class IndexedDbCredentialStoreAdapter {

  private storageReady: Promise<void>;

  constructor(private storage: Storage) {
    // Ionic Storage requiere inicializar la base de datos antes de usarla
    this.storageReady = this.initStorage();
  }

  private async initStorage(): Promise<void> {
    await this.storage.create();
  }

  // =====================================================================
  // MÉTODOS PARA DOME RECOVERY (TAREA 19 - EUDISTACK-144)
  // =====================================================================

  /**
   * Guarda el estado de finalización de la recuperación en el store local.
   */
  async setDomeRecoveryCompleted(status: boolean): Promise<void> {
    await this.storageReady; // Esperamos a que la BBDD esté lista
    await this.storage.set('dome_recovery_completed', status);
  }

  /**
   * Recupera el estado de finalización. Si no existe, por defecto es false.
   */
  async getDomeRecoveryCompleted(): Promise<boolean> {
    await this.storageReady;
    const status = await this.storage.get('dome_recovery_completed');
    return status === true;
  }

  /**
   * Guarda la clave de idempotencia actual para reintentos seguros.
   */
  async setDomeIdempotencyKey(key: string): Promise<void> {
    await this.storageReady;
    await this.storage.set('dome_idempotency_key', key);
  }

  /**
   * Recupera la clave de idempotencia actual.
   */
  async getDomeIdempotencyKey(): Promise<string | null> {
    await this.storageReady;
    return await this.storage.get('dome_idempotency_key');
  }

  // Nota: Si el puerto requiriera guardar credenciales en el futuro,
  // añadiríamos aquí un método saveCredentials(...)
}
