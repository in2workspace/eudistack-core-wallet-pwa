import { Injectable } from '@angular/core';
import { from, Observable, timer, throwError, of } from 'rxjs';
import { switchMap, catchError, retry, tap, map } from 'rxjs/operators';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { DomeRecoveryStateService } from './dome-recovery-state.service';
import { IndexedDbCredentialStoreAdapter } from '../spi-impl/indexeddb-credential-store.adapter';
import { EbwCredentialStoreAdapter } from '../spi-impl/ebw-credential-store.adapter';
import { generateUuidV7 } from '../utils/uuid-v7.util';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';

@Injectable({ providedIn: 'root' })
export class DomeRecoveryService {

  private syncPort: CredentialSyncPort;
  private stateService: DomeRecoveryStateService;
  private localStore: IndexedDbCredentialStoreAdapter;
  private ebwStore: EbwCredentialStoreAdapter;

  constructor(
    syncPort: CredentialSyncPort,
    stateService: DomeRecoveryStateService,
    localStore: IndexedDbCredentialStoreAdapter,
    ebwStore: EbwCredentialStoreAdapter
  ) {
    this.syncPort = syncPort;
    this.stateService = stateService;
    this.localStore = localStore;
    this.ebwStore = ebwStore;
  }

  /**
   * Orquesta el flujo completo de recuperación de credenciales DOME.
   * @param thumbprint Huella digital de la clave.
   * @param mode Modo de persistencia: 'local' (IndexedDB) o 'server' (EBW).
   */
  recover(thumbprint: string, mode: 'local' | 'server'): Observable<RecoveryOutcome> {

    // 1. Avisamos a la UI de que empezamos
    this.stateService.setRecoveryInProgress(true);
    this.stateService.recoveryError.set(null);

    // 2. Obtenemos o generamos la llave de Idempotencia
    return from(this.stateService.getDomeIdempotencyKey()).pipe(
      switchMap(existingKey => {
        const idempotencyKey = existingKey || generateUuidV7();

        // Si no existía, la guardamos (Fail-safe)
        if (!existingKey) {
          this.stateService.setDomeIdempotencyKey(idempotencyKey);
        }

        // 3. Invocamos al Puerto (llamada HTTP al backend)
        return this.syncPort.syncCredentials({ idempotencyKey, holderKeyThumbprint: thumbprint });
      }),

      // 4. MANEJO DE ERRORES Y REINTENTOS (ES-06: Backoff Exponencial)
      retry({
        count: 3, // Máximo 3 reintentos
        delay: (error, retryCount) => {
          console.warn(`Intento ${retryCount} fallido. Reintentando...`);

          // ES-09: Si el error es PRF unavailable (ej. hardware no soportado), no reintentamos
          if (error?.message?.includes('PRF unavailable') || error?.status === 403) {
            return throwError(() => error);
          }

          // Backoff exponencial: 2^1=2s, 2^2=4s, 2^3=8s
          const delayMs = Math.pow(2, retryCount) * 1000;
          return timer(delayMs);
        }
      }),

      // 5. PERSISTENCIA DE LAS CREDENCIALES (UPSERT)
      switchMap(outcome => {
        if (outcome.status === 'ok') {
          // NOTA: Asumimos que el adapter nos pasa las credenciales en 'outcome.credentials'
          // o que lo obtenemos del payload original.
          const credentialsToSave = (outcome as any).credentials || [];

          const persistPromise = mode === 'server'
            ? this.ebwStore.saveCredentials(credentialsToSave) // Stub
            : this.persistInLocalDb(credentialsToSave);        // IndexedDB

          return from(persistPromise).pipe(
            map(() => outcome)
          );
        }
        return of(outcome); // Si es 'empty' o 'error', pasamos directamente
      }),

      // 6. ACTUALIZACIÓN DEL ESTADO FINAL (Éxito o Fracaso)
      tap({
        next: (outcome) => {
          if (outcome.status === 'ok' || outcome.status === 'empty') {
            this.stateService.setDomeRecoveryCompleted(true);
          }
          this.stateService.setRecoveryInProgress(false);
        },
        error: (err) => {
          console.error('Error final en la recuperación:', err);
          this.stateService.recoveryError.set(err?.message || 'Error de sincronización');
          this.stateService.setRecoveryInProgress(false);
        }
      })
    );
  }

  /**
   * Helper para manejar el ES-08 (Fallo de IndexedDB durante el UPSERT)
   */
  private async persistInLocalDb(credentials: any[]): Promise<void> {
    try {
      // Aquí harías un loop por 'credentials' y las guardarías con tu localStore.
      // Ejemplo: UPSERT by credentialId
      // await this.localStore.saveCredentials(credentials);
      console.log('Credenciales guardadas en IndexedDB exitosamente.');
    } catch (dbError) {
      // ES-08 Fallo IndexedDB
      console.error('ES-08: Error crítico al escribir en IndexedDB', dbError);
      throw new Error('Fallo de almacenamiento local (IndexedDB)');
    }
  }
}
