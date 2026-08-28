import { Injectable, inject } from '@angular/core';

import { StorageService } from '../../shared/services/storage.service';
import { UI_TRANSLATION_CACHE_KEY_PREFIX, MAX_CACHED_TRANSLATIONS } from '../constants/ui-translation.constants';
import { CachedUiTranslation, LanguageTag, SCHEMA_VERSION, UiTextEntry } from '../models/ui-text-translation.model';
import { TelemetryService } from './telemetry.service';

/** LRU index entry — tracks recency without re-reading every cached record. */
interface CacheIndexEntry {
  readonly cacheKey: string;
  readonly lastUsedAt: number;
}

const INDEX_KEY = `${UI_TRANSLATION_CACHE_KEY_PREFIX}__index__`;

/**
 * Type-guard validating a value read from `StorageService` has the exact
 * shape of a `CachedUiTranslation` — schema version, field types, and that
 * every entry is a well-formed `{ key, text }` pair (ES-07). **Does not**
 * verify that those keys belong to the current pristine bundle — that check
 * needs the pristine bundle's key set, which this service is never given;
 * `UiTextTranslationService` (task 15) re-derives the merge from the
 * pristine bundle, so a stale/foreign key from an invalid-but-shape-valid
 * record has no effect once merged.
 */
export function isCachedUiTranslation(value: unknown): value is CachedUiTranslation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    candidate['schemaVersion'] === SCHEMA_VERSION &&
    typeof candidate['sourceLang'] === 'string' &&
    typeof candidate['targetLang'] === 'string' &&
    typeof candidate['bundleHash'] === 'string' &&
    typeof candidate['lastUsedAt'] === 'number' &&
    Array.isArray(candidate['entries']) &&
    (candidate['entries'] as unknown[]).every(
      e => typeof e === 'object' && e !== null &&
        typeof (e as Record<string, unknown>)['key'] === 'string' &&
        typeof (e as Record<string, unknown>)['text'] === 'string',
    )
  );
}

/**
 * Persists validated runtime-translation results in `StorageService`
 * (`@ionic/storage-angular`/IndexedDB — same layer already storing the
 * `'language'` preference). Bounded to `MAX_CACHED_TRANSLATIONS`
 * simultaneous languages via LRU eviction (NFR-S-142-05). Contains only
 * target language, activation state and translated UI chrome text — never
 * credential content or personal data (AC-13).
 */
@Injectable({ providedIn: 'root' })
export class UiTranslationCacheService {
  private readonly storage = inject(StorageService);
  private readonly telemetry = inject(TelemetryService);

  /**
   * Returns the cached entries for `(sourceLang, targetLang, bundleHash)`,
   * or `null` on a miss — including a **release-drift miss** (EC-05): the
   * cache key embeds `bundleHash`, so a release with different source text
   * simply misses under a new key rather than serving stale translations. A
   * shape-invalid record at that key (ES-07) is treated as a miss and
   * removed.
   */
  async read(sourceLang: LanguageTag, targetLang: LanguageTag, bundleHash: string): Promise<ReadonlyArray<UiTextEntry> | null> {
    const key = this.cacheKey(sourceLang, targetLang, bundleHash);
    let raw: unknown;
    try {
      raw = await this.storage.get(key);
    } catch {
      return null;
    }
    if (raw === undefined || raw === null) {
      return null;
    }
    if (!isCachedUiTranslation(raw)) {
      // ES-07 — invalid/corrupt/unknown-shape record: discard, never apply.
      await this.storage.remove(key).catch(() => undefined);
      return null;
    }
    await this.touch(key).catch(() => undefined);
    return raw.entries;
  }

  /**
   * Writes `entry` and updates the LRU index, evicting the least-recently-used
   * language beyond `MAX_CACHED_TRANSLATIONS` if needed. Tolerant of storage
   * quota errors (EC-11): a failed write is telemetered and swallowed —
   * translation activation continues without caching this result.
   */
  async write(entry: CachedUiTranslation): Promise<void> {
    const key = this.cacheKey(entry.sourceLang, entry.targetLang, entry.bundleHash);
    try {
      await this.storage.set(key, entry);
      await this.updateIndex(key, entry.lastUsedAt);
      await this.evictBeyondLimit();
    } catch {
      this.telemetry.track('ui_translation_cache_unavailable', {
        sourceLang: entry.sourceLang,
        targetLang: entry.targetLang,
      });
    }
  }

  /** Evicts the least-recently-used cached languages beyond `MAX_CACHED_TRANSLATIONS`. */
  async evictBeyondLimit(): Promise<void> {
    const index = await this.readIndex();
    if (index.length <= MAX_CACHED_TRANSLATIONS) {
      return;
    }
    const sortedByRecency = [...index].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
    const toEvict = sortedByRecency.slice(0, index.length - MAX_CACHED_TRANSLATIONS);
    for (const { cacheKey } of toEvict) {
      await this.storage.remove(cacheKey).catch(() => undefined);
    }
    const evictedKeys = new Set(toEvict.map(e => e.cacheKey));
    await this.writeIndex(index.filter(e => !evictedKeys.has(e.cacheKey)));
  }

  private cacheKey(sourceLang: LanguageTag, targetLang: LanguageTag, bundleHash: string): string {
    return `${UI_TRANSLATION_CACHE_KEY_PREFIX}${sourceLang}:${targetLang}:${bundleHash}`;
  }

  private async touch(cacheKey: string): Promise<void> {
    const index = await this.readIndex();
    const now = Date.now();
    const existing = index.some(e => e.cacheKey === cacheKey);
    const next = existing
      ? index.map(e => (e.cacheKey === cacheKey ? { cacheKey, lastUsedAt: now } : e))
      : [...index, { cacheKey, lastUsedAt: now }];
    await this.writeIndex(next);
  }

  private async updateIndex(cacheKey: string, lastUsedAt: number): Promise<void> {
    const index = await this.readIndex();
    const withoutKey = index.filter(e => e.cacheKey !== cacheKey);
    await this.writeIndex([...withoutKey, { cacheKey, lastUsedAt }]);
  }

  private async readIndex(): Promise<CacheIndexEntry[]> {
    const raw = await this.storage.get(INDEX_KEY).catch(() => undefined);
    return Array.isArray(raw) ? raw as CacheIndexEntry[] : [];
  }

  private async writeIndex(index: CacheIndexEntry[]): Promise<void> {
    await this.storage.set(INDEX_KEY, index);
  }
}
