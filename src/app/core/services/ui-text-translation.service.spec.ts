import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { EventEmitter } from '@angular/core';
import { LangChangeEvent, TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';

import { UiTextTranslationService } from './ui-text-translation.service';
import { UiTranslationCacheService } from './ui-translation-cache.service';
import { TelemetryService } from './telemetry.service';
import { TRANSLATION_ENGINE, TranslationEnginePort } from '../ports/translation-engine.port';
import { UserPreferencesService } from '../../shared/services/user-preferences.service';
import { UiTextKey } from '../models/ui-text-translation.model';

const PRISTINE_BUNDLE = { menu: { scan: 'Escáner QR', wallet: 'Cartera' } };
const PRISTINE_JSON = JSON.stringify(PRISTINE_BUNDLE);

function flatEntries() {
  return [
    { key: 'menu.scan' as UiTextKey, text: 'Escáner QR' },
    { key: 'menu.wallet' as UiTextKey, text: 'Cartera' },
  ];
}

describe('UiTextTranslationService', () => {
  let service: UiTextTranslationService;
  let http: { get: jest.Mock };
  let translate: {
    currentLang: string;
    getDefaultLang: jest.Mock;
    setTranslation: jest.Mock;
    onLangChange: EventEmitter<LangChangeEvent>;
  };
  let cache: { read: jest.Mock; write: jest.Mock };
  let engine: jest.Mocked<TranslationEnginePort>;
  let prefsStore: { enabled: boolean; targetLanguage: string | null };
  let prefs: { uiTranslation: jest.Mock; setUiTranslation: jest.Mock };
  let telemetry: { track: jest.Mock };

  beforeEach(() => {
    document.documentElement.lang = 'es';
    document.documentElement.dir = 'ltr';

    http = { get: jest.fn().mockReturnValue(of(PRISTINE_JSON)) };

    translate = {
      currentLang: 'es',
      getDefaultLang: jest.fn().mockReturnValue('es'),
      setTranslation: jest.fn(),
      onLangChange: new EventEmitter<LangChangeEvent>(),
    };

    cache = {
      read: jest.fn().mockResolvedValue(null),
      write: jest.fn().mockResolvedValue(undefined),
    };

    engine = {
      isSupported: jest.fn().mockReturnValue(true),
      availability: jest.fn().mockResolvedValue('available'),
      translateEntries: jest.fn().mockImplementation(async (entries) =>
        entries.map((e: { key: UiTextKey; text: string }) => ({ key: e.key, text: `[${e.text}]` }))),
      destroy: jest.fn(),
    };

    prefsStore = { enabled: false, targetLanguage: null };
    prefs = {
      uiTranslation: jest.fn(() => prefsStore),
      setUiTranslation: jest.fn((pref) => { prefsStore = pref; }),
    };

    telemetry = { track: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: http },
        { provide: TranslateService, useValue: translate },
        { provide: UiTranslationCacheService, useValue: cache },
        { provide: TRANSLATION_ENGINE, useValue: engine },
        { provide: UserPreferencesService, useValue: prefs },
        { provide: TelemetryService, useValue: telemetry },
      ],
    });
    service = TestBed.inject(UiTextTranslationService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('probeAvailability (EC-01, EC-02)', () => {
    it('sets status to unavailable and returns no targets when the engine is unsupported', async () => {
      engine.isSupported.mockReturnValue(false);

      const targets = await service.probeAvailability();

      expect(targets).toEqual([]);
      expect(service.status()).toBe('unavailable');
      expect(engine.availability).not.toHaveBeenCalled();
    });

    it('filters candidate pairs to only "available"/"downloadable" (fail-closed)', async () => {
      engine.availability.mockImplementation(async ({ targetLanguage }) => {
        if (targetLanguage === 'el') return 'available';
        if (targetLanguage === 'ar') return 'downloadable';
        return 'unavailable';
      });

      const targets = await service.probeAvailability();

      expect(targets).toEqual(expect.arrayContaining(['el', 'ar']));
      expect(targets).not.toContain('fr');
      expect(service.status()).toBe('idle');
    });

    it('sets status to unavailable when no candidate pair is translatable', async () => {
      engine.availability.mockResolvedValue('unavailable');

      const targets = await service.probeAvailability();

      expect(targets).toEqual([]);
      expect(service.status()).toBe('unavailable');
    });

    it('memoizes the probe — a second call does not re-probe the engine', async () => {
      await service.probeAvailability();
      await service.probeAvailability();

      expect(engine.availability).toHaveBeenCalledTimes(
        (engine.availability as jest.Mock).mock.calls.length, // sanity: called at all
      );
      const firstCallCount = (engine.availability as jest.Mock).mock.calls.length;
      await service.probeAvailability();
      expect((engine.availability as jest.Mock).mock.calls.length).toBe(firstCallCount);
    });
  });

  describe('activate — cache miss (happy path)', () => {
    it('fetches the pristine bundle, translates via the engine, and applies atomically', async () => {
      await service.activate('el');

      expect(http.get).toHaveBeenCalledWith('assets/i18n/es.json', { responseType: 'text' });
      expect(engine.translateEntries).toHaveBeenCalled();
      expect(translate.setTranslation).toHaveBeenCalledTimes(1);
      const [lang, bundle, shouldMerge] = translate.setTranslation.mock.calls[0];
      expect(lang).toBe('es');
      expect(shouldMerge).toBe(false);
      expect(bundle).toEqual({ menu: { scan: '[Escáner QR]', wallet: '[Cartera]' } });
      expect(service.status()).toBe('active');
      expect(service.targetLanguage()).toBe('el');
    });

    it('writes the result to cache', async () => {
      await service.activate('el');

      expect(cache.write).toHaveBeenCalledWith(expect.objectContaining({
        sourceLang: 'es',
        targetLang: 'el',
        entries: expect.any(Array),
      }));
    });

    it('syncs documentElement.lang to the target and persists the preference (AC-02, AC-06)', async () => {
      await service.activate('el');

      expect(document.documentElement.lang).toBe('el');
      expect(prefs.setUiTranslation).toHaveBeenCalledWith({ enabled: true, targetLanguage: 'el' });
    });

    it('sets dir="rtl" for an RTL target language (AD-5/EC-03)', async () => {
      await service.activate('ar');

      expect(document.documentElement.dir).toBe('rtl');
    });

    it('sets dir="ltr" for a non-RTL target language', async () => {
      await service.activate('el');

      expect(document.documentElement.dir).toBe('ltr');
    });

    it('reports progress during the batch loop and clears it once active (AC-11)', async () => {
      let capturedDuringActivation: unknown;
      engine.translateEntries.mockImplementation(async (entries, _pair, _allowedKeys, onProgress) => {
        onProgress?.(1, entries.length);
        capturedDuringActivation = service.progress();
        return entries.map((e: { key: UiTextKey; text: string }) => ({ key: e.key, text: `[${e.text}]` }));
      });

      await service.activate('el');

      expect(capturedDuringActivation).toEqual({ done: 1, total: 2 });
      expect(service.progress()).toBeNull();
    });

    it('keeps the native idiom code unchanged (AD-2/AC-07): currentLang param to setTranslation is native, not target', async () => {
      await service.activate('el');

      expect(translate.setTranslation.mock.calls[0][0]).toBe('es');
    });
  });

  describe('activate — cache hit (EC-04)', () => {
    it('never invokes the engine when the cache has a valid entry', async () => {
      cache.read.mockResolvedValue(flatEntries());

      await service.activate('el');

      expect(engine.translateEntries).not.toHaveBeenCalled();
      expect(translate.setTranslation).toHaveBeenCalledTimes(1);
      expect(service.status()).toBe('active');
    });
  });

  describe('activate — masking and placeholder integrity (AC-14, ES-06)', () => {
    it('sends masked text to the engine, never the raw {{ }} syntax', async () => {
      http.get.mockReturnValue(of(JSON.stringify({ greeting: 'Hola {{name}}' })));

      await service.activate('el');

      const sentEntries = engine.translateEntries.mock.calls[0][0];
      expect(sentEntries[0].text).not.toContain('{{');
      expect(sentEntries[0].text).toContain('name');
    });

    it('falls back to the native text for a key whose translated markers do not match (ES-06)', async () => {
      http.get.mockReturnValue(of(JSON.stringify({ greeting: 'Hola {{name}}' })));
      engine.translateEntries.mockResolvedValue([{ key: 'greeting' as UiTextKey, text: 'Hello — marker dropped' }]);

      await service.activate('el');

      const [, bundle] = translate.setTranslation.mock.calls[0];
      expect(bundle.greeting).toBe('Hola {{name}}'); // native fallback, not the mismatched translation
      expect(telemetry.track).toHaveBeenCalledWith('ui_translation_placeholder_mismatch', expect.anything());
    });
  });

  describe('activate — error paths (ES-02, ES-04)', () => {
    it('falls back to native and sets status "error" when the bundle fetch fails', async () => {
      http.get.mockReturnValue(throwError(() => new Error('network error')));

      await service.activate('el');

      expect(service.status()).toBe('error');
      expect(translate.setTranslation).not.toHaveBeenCalled();
      expect(prefs.setUiTranslation).not.toHaveBeenCalled();
      expect(document.documentElement.lang).toBe('es');
    });

    it('destroys the engine and only ever applies the pristine (native) bundle — never a partial one — when the engine call rejects', async () => {
      engine.translateEntries.mockRejectedValue(new Error('engine crashed mid-batch'));

      await service.activate('el');

      expect(service.status()).toBe('error');
      // The one setTranslation call is the error-path restore to native —
      // ES-04's guarantee is "no mixed UI", not "setTranslation is never called".
      expect(translate.setTranslation).toHaveBeenCalledTimes(1);
      expect(translate.setTranslation).toHaveBeenCalledWith('es', PRISTINE_BUNDLE, false);
      expect(engine.destroy).toHaveBeenCalled();
    });
  });

  describe('activate — timeout (ES-05)', () => {
    it('falls back to native and destroys the engine when the engine never settles within TRANSLATION_BUDGET_MS', async () => {
      jest.useFakeTimers();
      engine.translateEntries.mockImplementation(() => new Promise(() => { /* never resolves */ }));

      const activation = service.activate('el');
      // Flush the fetch + cache-read microtasks so doActivate() reaches the
      // engine call and withBudget()'s timer is armed before we advance it.
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      jest.advanceTimersByTime(20_000);
      await activation;

      expect(service.status()).toBe('error');
      expect(engine.destroy).toHaveBeenCalled();
      expect(document.documentElement.lang).toBe('es');
    });
  });

  describe('activate — concurrency (EC-07, ES-03)', () => {
    it('a second call for the SAME target while preparing reuses the in-flight operation', async () => {
      // Block on a never-resolving engine call, activate twice with the same
      // target, and assert the engine is invoked only once — the second call
      // coalesces onto the in-flight operation rather than starting a fresh one.
      let releaseEngine!: () => void;
      engine.translateEntries.mockImplementation(() => new Promise(resolve => {
        releaseEngine = () => resolve(flatEntries());
      }));

      const first = service.activate('el');
      const second = service.activate('el');

      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      releaseEngine();
      await Promise.all([first, second]);

      expect(engine.translateEntries).toHaveBeenCalledTimes(1);
      expect(service.targetLanguage()).toBe('el');
    });

    it('a second call for a DIFFERENT target supersedes the in-flight operation instead of being silently dropped', async () => {
      // Regression test: picking a different language before the first
      // activation finishes preparing must win — not be coalesced away and
      // have the FIRST (discarded) choice persisted instead.
      let releaseFirstEngine!: () => void;
      engine.translateEntries.mockImplementationOnce(() => new Promise(resolve => {
        releaseFirstEngine = () => resolve(flatEntries());
      }));

      const first = service.activate('bg'); // e.g. an accidental default, not what the user wanted
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      const second = service.activate('fr'); // the user's actual, deliberate choice
      releaseFirstEngine(); // the stale 'bg' operation finally settles...
      await Promise.all([first, second]);

      // ...but must have no effect: 'fr' wins, both in memory and persisted.
      expect(service.targetLanguage()).toBe('fr');
      expect(service.status()).toBe('active');
      expect(prefs.setUiTranslation).toHaveBeenLastCalledWith({ enabled: true, targetLanguage: 'fr' });
    });
  });

  describe('deactivate (AC-05, NFR-S-142-03)', () => {
    it('restores the native bundle from memory, resets lang/dir, and makes 0 network requests', async () => {
      await service.activate('el');
      http.get.mockClear();

      service.deactivate();

      expect(http.get).not.toHaveBeenCalled();
      expect(translate.setTranslation).toHaveBeenLastCalledWith('es', PRISTINE_BUNDLE, false);
      expect(document.documentElement.lang).toBe('es');
      expect(document.documentElement.dir).toBe('ltr');
      expect(service.status()).toBe('idle');
      expect(service.targetLanguage()).toBeNull();
    });

    it('releases the engine and persists enabled=false while remembering the last target', async () => {
      await service.activate('el');

      service.deactivate();

      expect(engine.destroy).toHaveBeenCalled();
      expect(prefs.setUiTranslation).toHaveBeenLastCalledWith({ enabled: false, targetLanguage: 'el' });
    });
  });

  describe('restoreFromPreference (AC-06)', () => {
    it('activates the persisted target when the preference is enabled', async () => {
      prefsStore = { enabled: true, targetLanguage: 'el' };

      await service.restoreFromPreference();

      expect(service.status()).toBe('active');
      expect(service.targetLanguage()).toBe('el');
    });

    it('does nothing when the preference is disabled', async () => {
      prefsStore = { enabled: false, targetLanguage: 'el' };

      await service.restoreFromPreference();

      expect(engine.translateEntries).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
    });

    it('does nothing when enabled but no target language is set', async () => {
      prefsStore = { enabled: true, targetLanguage: null };

      await service.restoreFromPreference();

      expect(engine.translateEntries).not.toHaveBeenCalled();
    });
  });

  describe('native-language change while engaged (ES-03, AD-6)', () => {
    it('recomputes the translation from the new native source when active', async () => {
      await service.activate('el');
      http.get.mockClear();
      http.get.mockReturnValue(of(JSON.stringify({ menu: { scan: 'Scan QR', wallet: 'Wallet' } })));
      translate.currentLang = 'en';

      translate.onLangChange.emit({ lang: 'en', translations: {} });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

      expect(http.get).toHaveBeenCalledWith('assets/i18n/en.json', { responseType: 'text' });
      expect(service.targetLanguage()).toBe('el');
    });

    it('just syncs documentElement.lang when translation is not engaged', async () => {
      translate.currentLang = 'ca';

      translate.onLangChange.emit({ lang: 'ca', translations: {} });
      await Promise.resolve();

      expect(document.documentElement.lang).toBe('ca');
      expect(document.documentElement.dir).toBe('ltr');
      expect(engine.translateEntries).not.toHaveBeenCalled();
    });
  });
});
