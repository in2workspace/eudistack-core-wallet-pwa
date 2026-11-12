import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { ActivityService } from './activity.service';
import { CredentialStatusCheckService } from './credential-status-check.service';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { SyncSupersededError, WalletService } from './wallet.service';

/**
 * Keeps the local copy of the attestations in step with the server session.
 *
 * In server mode the attestations live in the Wallet Unit Service, which only
 * returns those bound to the session's passkey (EUD-11 prd §3.3). The local
 * store is just a copy of `GET /api/v1/credentials` for the current session:
 * it is replaced when a session starts and dropped when it ends, so the wallet
 * never shows an attestation the server no longer returns for this session.
 */
@Injectable({ providedIn: 'root' })
export class ServerSessionDataService {
  private readonly walletService = inject(WalletService);
  private readonly credentialStorage = inject(LocalCredentialStorageService);
  private readonly credentialCache = inject(CredentialCacheService);
  private readonly activityService = inject(ActivityService);
  private readonly statusCheck = inject(CredentialStatusCheckService);

  /** Replaces the local attestations with the session's. Never rejects. */
  async sessionStarted(): Promise<void> {
    this.walletService.invalidatePendingSyncs();
    this.credentialCache.clearSyncState();
    this.credentialCache.setLoading();
    this.credentialCache.markSyncStarted();
    try {
      await firstValueFrom(this.walletService.syncCredentials());
      void this.statusCheck.checkAll();
    } catch (err) {
      if (err instanceof SyncSupersededError) {
        return;
      }
      console.error('[ServerSessionDataService] Credential sync failed', err);
      // The local copy may belong to an earlier session: never show it in this one.
      await this.dropLocalCredentials();
      this.credentialCache.markSyncFailed('initial');
      this.credentialCache.setError();
    }
    void this.activityService.syncFromServer();
  }

  /**
   * Synchronizes on the user's request. It does not block the list: the copy stays visible until it ends, and a
   * failure keeps it with a notice. If the session never got its attestations, it starts over as a new session.
   * Never rejects.
   */
  async refresh(): Promise<void> {
    if (this.credentialCache.syncError() === 'initial') {
      return this.sessionStarted();
    }
    this.credentialCache.markSyncStarted();
    try {
      await firstValueFrom(this.walletService.syncCredentials());
      void this.statusCheck.checkAll();
    } catch (err) {
      if (err instanceof SyncSupersededError) {
        return;
      }
      console.error('[ServerSessionDataService] Credential sync failed', err);
      this.credentialCache.markSyncFailed('refresh');
    }
  }

  /** Drops the local attestations of a session that has ended. Never rejects. */
  async sessionEnded(): Promise<void> {
    // A synchronization still in flight would put the attestations of this session back in the store.
    this.walletService.invalidatePendingSyncs();
    await this.dropLocalCredentials();
    this.credentialCache.clearSyncState();
  }

  private async dropLocalCredentials(): Promise<void> {
    try {
      await this.credentialStorage.clearAllCredentials();
    } catch (err) {
      console.error('[ServerSessionDataService] Could not clear the local credentials', err);
    }
    this.credentialCache.setLoaded([]);
  }
}
