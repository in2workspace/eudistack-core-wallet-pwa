import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { StorageService } from '../../shared/services/storage.service';
import { ActivityEntry, ActivityType } from '../models/activity.model';
import { ServerActivityGateway } from '../gateways/server-activity.gateway';
import { WalletDiscoveryService } from './wallet-discovery.service';

const STORAGE_KEY = 'wallet_activity';
const MAX_ENTRIES = 200;

@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly storage = inject(StorageService);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly serverGateway = inject(ServerActivityGateway);

  /** Returns true when the wallet operates in browser (EUDIW) mode (ES-05). */
  private isBrowserMode(): boolean {
    return this.discovery.mode() !== 'server';
  }

  async log(
    type: ActivityType,
    credentialName: string,
    counterparty: string,
    details?: string,
    sharedAttributes?: string[],
  ): Promise<void> {
    const entries = await this.loadEntries();
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      type,
      credentialName,
      counterparty,
      timestamp: Date.now(),
      details,
      sharedAttributes,
    };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    await this.storage.set(STORAGE_KEY, JSON.stringify(entries));

    if (!this.isBrowserMode()) {
      // Best-effort: the entry is already cached locally; a failed append is
      // retried implicitly on the next syncFromServer()/findAll() (AD-1/AD-4).
      firstValueFrom(this.serverGateway.append(entry)).catch(() => undefined);
    }
  }

  async findAll(): Promise<ActivityEntry[]> {
    if (this.isBrowserMode()) {
      return this.loadEntries();
    }
    try {
      return await this.fetchAndCacheFromServer();
    } catch {
      // Server unreachable (ES-04): fall back to the local cache, never clear it (AD-4).
      return this.loadEntries();
    }
  }

  /** Recovers/synchronizes the history from the server (AC-01/AC-02), e.g. after login. No-op in browser mode (ES-05). */
  async syncFromServer(): Promise<void> {
    if (this.isBrowserMode()) {
      return;
    }
    try {
      await this.fetchAndCacheFromServer();
    } catch {
      // Server unreachable (ES-04): keep the existing cache; retried on next sync/findAll (AD-4).
    }
  }

  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
  }

  private async fetchAndCacheFromServer(): Promise<ActivityEntry[]> {
    const entries = await firstValueFrom(this.serverGateway.list());
    await this.storage.set(STORAGE_KEY, JSON.stringify(entries));
    return entries;
  }

  private async loadEntries(): Promise<ActivityEntry[]> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as ActivityEntry[];
    } catch {
      return [];
    }
  }
}
