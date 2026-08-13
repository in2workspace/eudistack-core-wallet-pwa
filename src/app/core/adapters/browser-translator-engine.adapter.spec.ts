import { TestBed } from '@angular/core/testing';
import { BrowserTranslatorEngineAdapter } from './browser-translator-engine.adapter';
import { TelemetryService } from '../services/telemetry.service';
import { UiTextEntry, UiTextKey } from '../models/ui-text-translation.model';

function entry(key: string, text: string): UiTextEntry {
  return { key: key as UiTextKey, text };
}

/** Convenience for building the `allowedKeys` set the port now requires. */
function allow(...keys: string[]): ReadonlySet<UiTextKey> {
  return new Set(keys as UiTextKey[]);
}

describe('BrowserTranslatorEngineAdapter', () => {
  let adapter: BrowserTranslatorEngineAdapter;
  let telemetry: TelemetryService;
  let originalTranslator: unknown;

  beforeEach(() => {
    originalTranslator = (globalThis as { Translator?: unknown }).Translator;
    TestBed.configureTestingModule({ providers: [BrowserTranslatorEngineAdapter] });
    adapter = TestBed.inject(BrowserTranslatorEngineAdapter);
    telemetry = TestBed.inject(TelemetryService);
  });

  afterEach(() => {
    (globalThis as { Translator?: unknown }).Translator = originalTranslator;
    jest.restoreAllMocks();
  });

  function installFakeTranslator(overrides: Partial<{
    availability: jest.Mock;
    translate: jest.Mock;
    destroy: jest.Mock;
  }> = {}) {
    const translateFn = overrides.translate ?? jest.fn(async (text: string) => `[${text}]`);
    const destroyFn = overrides.destroy ?? jest.fn();
    const availabilityFn = overrides.availability ?? jest.fn().mockResolvedValue('available');
    const createFn = jest.fn().mockResolvedValue({ translate: translateFn, destroy: destroyFn });

    (globalThis as { Translator?: unknown }).Translator = {
      availability: availabilityFn,
      create: createFn,
    };
    return { translateFn, destroyFn, availabilityFn, createFn };
  }

  describe('isSupported', () => {
    it('is false when Translator is not defined', () => {
      delete (globalThis as { Translator?: unknown }).Translator;
      expect(adapter.isSupported()).toBe(false);
    });

    it('is false when Translator is defined but lacks availability()', () => {
      (globalThis as { Translator?: unknown }).Translator = {};
      expect(adapter.isSupported()).toBe(false);
    });

    it('is true when Translator exposes availability() (EC-01)', () => {
      installFakeTranslator();
      expect(adapter.isSupported()).toBe(true);
    });
  });

  describe('availability', () => {
    it('returns "unavailable" without probing when the engine is not supported', async () => {
      delete (globalThis as { Translator?: unknown }).Translator;

      const result = await adapter.availability({ sourceLanguage: 'es', targetLanguage: 'el' });

      expect(result).toBe('unavailable');
    });

    it('forwards the engine\'s availability result for a supported pair', async () => {
      const { availabilityFn } = installFakeTranslator({ availability: jest.fn().mockResolvedValue('downloadable') });

      const result = await adapter.availability({ sourceLanguage: 'es', targetLanguage: 'el' });

      expect(result).toBe('downloadable');
      expect(availabilityFn).toHaveBeenCalledWith({ sourceLanguage: 'es', targetLanguage: 'el' });
    });

    it('degrades to "unavailable" when the probe itself throws', async () => {
      installFakeTranslator({ availability: jest.fn().mockRejectedValue(new Error('boom')) });

      const result = await adapter.availability({ sourceLanguage: 'es', targetLanguage: 'el' });

      expect(result).toBe('unavailable');
    });
  });

  describe('translateEntries', () => {
    const pair = { sourceLanguage: 'es', targetLanguage: 'el' };

    it('translates every entry and reports progress per chunk', async () => {
      installFakeTranslator();
      const entries = Array.from({ length: 30 }, (_, i) => entry(`menu.item-${i}`, `text-${i}`));
      const allowedKeys = allow(...entries.map(e => e.key as string));
      const onProgress = jest.fn();

      const result = await adapter.translateEntries(entries, pair, allowedKeys, onProgress);

      expect(result).toHaveLength(30);
      expect(result[0]).toEqual({ key: 'menu.item-0', text: '[text-0]' });
      // TRANSLATION_CHUNK_SIZE = 25 → two batches for 30 entries: 25, then 30.
      expect(onProgress).toHaveBeenCalledWith(25, 30);
      expect(onProgress).toHaveBeenCalledWith(30, 30);
    });

    it('memoizes the Translator instance across calls for the same pair', async () => {
      const { createFn } = installFakeTranslator();

      await adapter.translateEntries([entry('a', 'A')], pair, allow('a'), undefined);
      await adapter.translateEntries([entry('b', 'B')], pair, allow('b'), undefined);

      expect(createFn).toHaveBeenCalledTimes(1);
    });

    it('creates a distinct Translator per language pair', async () => {
      const { createFn } = installFakeTranslator();

      await adapter.translateEntries([entry('a', 'A')], { sourceLanguage: 'es', targetLanguage: 'el' }, allow('a'), undefined);
      await adapter.translateEntries([entry('a', 'A')], { sourceLanguage: 'es', targetLanguage: 'ar' }, allow('a'), undefined);

      expect(createFn).toHaveBeenCalledTimes(2);
    });

    it('returns an empty array without creating a Translator when entries is empty', async () => {
      const { createFn } = installFakeTranslator();

      const result = await adapter.translateEntries([], pair, allow(), undefined);

      expect(result).toEqual([]);
      expect(createFn).not.toHaveBeenCalled();
    });

    // --- ES-01: fail-closed guard (control 3/4) -----------------------------

    it('rejects the whole batch when one entry key falls under an excluded prefix', async () => {
      const { createFn } = installFakeTranslator();
      const trackSpy = jest.spyOn(telemetry, 'track');
      const entries = [entry('menu.scan', 'Scan'), entry('vc-fields.title', 'Should never reach the engine')];
      // Even if a future caller forgets to filter the deny-list out of
      // allowedKeys, the adapter's own isExcludedKey() check still catches it.
      const allowedKeys = allow('menu.scan', 'vc-fields.title');

      await expect(adapter.translateEntries(entries, pair, allowedKeys, undefined)).rejects.toThrow();

      expect(createFn).not.toHaveBeenCalled();
      expect(trackSpy).toHaveBeenCalledWith('ui_translation_rejected_entry', expect.objectContaining({
        sourceLanguage: 'es',
        targetLanguage: 'el',
      }));
      // The rejected text/key is never part of the telemetry payload.
      const payload = trackSpy.mock.calls[0][1];
      expect(JSON.stringify(payload)).not.toContain('vc-fields.title');
      expect(JSON.stringify(payload)).not.toContain('Should never reach the engine');
    });

    it('rejects the whole batch when a key is absent from allowedKeys, even if not under an excluded prefix (F3)', async () => {
      const { createFn } = installFakeTranslator();
      const entries = [entry('menu.scan', 'Scan'), entry('menu.wallet', 'Wallet')];
      // Simulates a stale/tampered allowedKeys — e.g. derived from a bundle
      // that no longer matches the entries passed in.
      const allowedKeys = allow('menu.scan');

      await expect(adapter.translateEntries(entries, pair, allowedKeys, undefined)).rejects.toThrow();

      expect(createFn).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('destroys every memoized Translator and clears the memoization', async () => {
      const { destroyFn, createFn } = installFakeTranslator();
      await adapter.translateEntries([entry('a', 'A')], { sourceLanguage: 'es', targetLanguage: 'el' }, allow('a'), undefined);

      adapter.destroy();
      await Promise.resolve(); // let the fire-and-forget .then() run

      expect(destroyFn).toHaveBeenCalledTimes(1);

      // A subsequent call for the same pair creates a fresh Translator.
      await adapter.translateEntries([entry('a', 'A')], { sourceLanguage: 'es', targetLanguage: 'el' }, allow('a'), undefined);
      expect(createFn).toHaveBeenCalledTimes(2);
    });

    it('does not throw when called with no Translator ever created', () => {
      installFakeTranslator();
      expect(() => adapter.destroy()).not.toThrow();
    });
  });
});
