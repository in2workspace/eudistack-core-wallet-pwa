import { Injectable } from '@angular/core';
import { StorageService } from '../../shared/services/storage.service';
import { ActivityEntry, ActivityType } from '../models/activity.model';

const STORAGE_KEY = 'wallet_activity';
const MAX_ENTRIES = 200;

@Injectable({ providedIn: 'root' })
export class ActivityService {

  constructor(private storage: StorageService) {}

  async log(
    type: ActivityType,
    credentialName: string,
    counterparty: string,
    details?: string,
  ): Promise<void> {
    const entries = await this.loadEntries();
    const entry: ActivityEntry = {
      id: crypto.randomUUID(),
      type,
      credentialName,
      counterparty,
      timestamp: Date.now(),
      details,
    };
    entries.unshift(entry);
    if (entries.length > MAX_ENTRIES) {
      entries.length = MAX_ENTRIES;
    }
    await this.storage.set(STORAGE_KEY, JSON.stringify(entries));
  }

  async findAll(): Promise<ActivityEntry[]> {
    return this.loadEntries();
  }

  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
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
