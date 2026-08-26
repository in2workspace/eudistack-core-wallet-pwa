import { TestBed } from '@angular/core/testing';
import { UiTranslationCacheService, isCachedUiTranslation } from './ui-translation-cache.service';
import { StorageService } from '../../shared/services/storage.service';
import { TelemetryService } from './telemetry.service';
import { CachedUiTranslation, SCHEMA_VERSION, UiTextKey } from '../models/ui-text-translation.model';

function record(overrides: Partial<CachedUiTranslation> = {}): CachedUiTranslation {
  return {
    schemaVersion: SCHEMA_VERSION,
    sourceLang: 'es',
    targetLang: 'el',
    bundleHash: 'abcd1234',
    entries: [{ key: 'menu.scan' as UiTextKey, text: 'Σάρωση' }],
    lastUsedAt: 1_000,
    ...overrides,
  };
}

describe('isCachedUiTranslation', () => {
  it('accepts a well-formed record', () => {
    expect(isCachedUiTranslation(record())).toBe(true);
  });

  const invalidCases: Array<[unknown, string]> = [
    ['not an object', 'string'],
    [null, 'null'],
    [{ ...record(), schemaVersion: 99 }, 'wrong schemaVersion'],
    [{ ...record(), sourceLang: 5 }, 'non-string sourceLang'],
    [{ ...record(), entries: 'not-an-array' }, 'non-array entries'],
    [{ ...record(), entries: [{ key: 'a' }] }, 'entry missing text'],
    [{ ...record(), lastUsedAt: '1000' }, 'non-number lastUsedAt'],
  ];

  it.each(invalidCases)('rejects an invalid record (%#: %s)', (value) => {
    expect(isCachedUiTranslation(value)).toBe(false);
  });
});

describe('UiTranslationCacheService', () => {
  let service: UiTranslationCacheService;
  let storage: { get: jest.Mock; set: jest.Mock; remove: jest.Mock };
  let telemetry: { track: jest.Mock };
  let store: Map<string, unknown>;

  beforeEach(() => {
    store = new Map();
    storage = {
      get: jest.fn((key: string) => Promise.resolve(store.get(key))),
      set: jest.fn((key: string, value: unknown) => { store.set(key, value); return Promise.resolve(); }),
      remove: jest.fn((key: string) => { store.delete(key); return Promise.resolve(); }),
    };
    telemetry = { track: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: StorageService, useValue: storage },
        { provide: TelemetryService, useValue: telemetry },
      ],
    });
    service = TestBed.inject(UiTranslationCacheService);
  });

  describe('read', () => {
    it('misses when nothing is cached for the pair', async () => {
      expect(await service.read('es', 'el', 'hash1')).toBeNull();
    });

    it('hits and returns the entries for a valid, matching record', async () => {
      await service.write(record());

      const result = await service.read('es', 'el', 'abcd1234');

      expect(result).toEqual(record().entries);
    });

    it('misses on release drift — a different bundleHash is a different key (EC-05)', async () => {
      await service.write(record({ bundleHash: 'old-hash' }));

      expect(await service.read('es', 'el', 'new-hash')).toBeNull();
    });

    it('discards and removes a shape-invalid record instead of applying it (ES-07)', async () => {
      const key = 'ui-translation-cache:es:el:abcd1234';
      store.set(key, { garbage: true });

      const result = await service.read('es', 'el', 'abcd1234');

      expect(result).toBeNull();
      expect(storage.remove).toHaveBeenCalledWith(key);
    });

    it('does not throw when storage.get rejects', async () => {
      storage.get.mockRejectedValueOnce(new Error('IndexedDB blocked'));

      await expect(service.read('es', 'el', 'abcd1234')).resolves.toBeNull();
    });
  });

  describe('write', () => {
    it('persists the record under a key keyed by source, target and bundleHash', async () => {
      await service.write(record());

      expect(storage.set).toHaveBeenCalledWith('ui-translation-cache:es:el:abcd1234', record());
    });

    it('tolerates a quota error without throwing and tracks telemetry (EC-11)', async () => {
      storage.set.mockRejectedValueOnce(new Error('QuotaExceededError'));

      await expect(service.write(record())).resolves.toBeUndefined();

      expect(telemetry.track).toHaveBeenCalledWith('ui_translation_cache_unavailable', expect.objectContaining({
        sourceLang: 'es',
        targetLang: 'el',
      }));
    });
  });

  describe('evictBeyondLimit (NFR-S-142-05: ≤ 3 simultaneous languages, LRU)', () => {
    it('evicts the least-recently-used language when the limit is exceeded', async () => {
      await service.write(record({ targetLang: 'el', bundleHash: 'h', lastUsedAt: 1_000 }));
      await service.write(record({ targetLang: 'ar', bundleHash: 'h', lastUsedAt: 2_000 }));
      await service.write(record({ targetLang: 'ja', bundleHash: 'h', lastUsedAt: 3_000 }));
      // 4th distinct language pushes the count to 4 > MAX_CACHED_TRANSLATIONS (3).
      await service.write(record({ targetLang: 'ko', bundleHash: 'h', lastUsedAt: 4_000 }));

      // Oldest (el, lastUsedAt 1_000) must be gone; the three most recent remain.
      expect(await service.read('es', 'el', 'h')).toBeNull();
      expect(await service.read('es', 'ar', 'h')).not.toBeNull();
      expect(await service.read('es', 'ja', 'h')).not.toBeNull();
      expect(await service.read('es', 'ko', 'h')).not.toBeNull();
    });

    it('keeps exactly MAX_CACHED_TRANSLATIONS languages after repeated writes', async () => {
      for (let i = 0; i < 5; i++) {
        await service.write(record({ targetLang: `lang-${i}`, bundleHash: 'h', lastUsedAt: i * 1_000 }));
      }

      const remaining = await Promise.all(
        Array.from({ length: 5 }, (_, i) => service.read('es', `lang-${i}`, 'h')),
      );
      expect(remaining.filter(r => r !== null)).toHaveLength(3);
    });

    it('reading a cached entry refreshes its recency (touch), protecting it from eviction', async () => {
      await service.write(record({ targetLang: 'el', bundleHash: 'h', lastUsedAt: 1_000 }));
      await service.write(record({ targetLang: 'ar', bundleHash: 'h', lastUsedAt: 2_000 }));
      await service.write(record({ targetLang: 'ja', bundleHash: 'h', lastUsedAt: 3_000 }));

      // Touch 'el' so it is no longer the least-recently-used.
      await service.read('es', 'el', 'h');

      await service.write(record({ targetLang: 'ko', bundleHash: 'h', lastUsedAt: 4_000 }));

      expect(await service.read('es', 'el', 'h')).not.toBeNull();
      expect(await service.read('es', 'ar', 'h')).toBeNull();
    });
  });
});
