import { Injectable } from '@angular/core';
import { from, Observable, timer, throwError, of } from 'rxjs';
import { switchMap, retry, tap, map } from 'rxjs/operators';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { DomeRecoveryStateService } from './dome-recovery-state.service';
import { IndexedDbCredentialStoreAdapter } from '../spi-impl/indexeddb-credential-store.adapter';
import { EbwCredentialStoreAdapter } from '../spi-impl/ebw-credential-store.adapter';
import { generateUuidV7 } from '../utils/uuid-v7.util';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';
import {VerifiableCredential} from "../models/verifiable-credential";

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

  recover(thumbprint: string, mode: 'local' | 'server'): Observable<RecoveryOutcome> {

    this.stateService.setRecoveryInProgress(true);
    this.stateService.recoveryError.set(null);

    return from(this.stateService.getDomeIdempotencyKey()).pipe(
      switchMap(existingKey => {
        const idempotencyKey = existingKey || generateUuidV7();

        if (!existingKey) {
          this.stateService.setDomeIdempotencyKey(idempotencyKey);
        }

        return this.syncPort.syncCredentials({ idempotencyKey, holderKeyThumbprint: thumbprint });
      }),

      retry({
        count: 3,
        delay: (error, retryCount) => {
          console.warn(`Attempt ${retryCount} failed. Retrying...`);

          if (error?.message?.includes('PRF unavailable') || error?.status === 403) {
            return throwError(() => error);
          }

          const delayMs = Math.pow(2, retryCount) * 1000;
          return timer(delayMs);
        }
      }),

      switchMap(outcome => {
        if (outcome.status === 'ok') {

          const credentialsToSave = outcome.credentials ?? [];

          const persistPromise = mode === 'server'
            ? this.ebwStore.saveCredentials(credentialsToSave)
            : this.persistInLocalDb(credentialsToSave);

          return from(persistPromise).pipe(
            map(() => outcome)
          );
        }
        return of(outcome);
      }),

      tap({
        next: (outcome) => {
          if (outcome.status === 'ok' || outcome.status === 'empty') {
            this.stateService.setDomeRecoveryCompleted(true);
          }
          this.stateService.setRecoveryInProgress(false);
        },
        error: (err) => {
          console.error('Recovery process failed', err);
          this.stateService.recoveryError.set(err?.message || 'Credential synchronization failed.');
          this.stateService.setRecoveryInProgress(false);
        }
      })
    );
  }

  private async persistInLocalDb(credentials: VerifiableCredential[]): Promise<void> {
    if (!credentials || credentials.length === 0) {
      console.warn('[DOME] No credentials received for persistence.');
      return;
    }

    try {
      await this.localStore.saveCredentials(credentials);

      console.log(`[DOME] Successfully persisted ${credentials.length} credentials to IndexedDB.`);
    } catch (dbError) {
      console.error('ES-08: Critical error while persisting credentials to IndexedDB', dbError);
      throw new Error('Local storage persistence failed (IndexedDB)');
    }
  }
}
