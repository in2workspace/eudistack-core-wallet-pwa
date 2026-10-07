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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

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
      prepare: jest.fn().mockResolvedValue(undefined),
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

      expect(capturedDuringActivation).toEqual({ phase: 'applying', fraction: 0.75 });
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

  describe('activate — cache hit, tampered record (security-auditor full-mode review, EUD-142 F2)', () => {
    it('drops a cached entry whose key is not part of the current pristine bundle', async () => {
      cache.read.mockResolvedValue([
        ...flatEntries(),
        { key: 'vc-fields.credentialInfo.issuerId' as UiTextKey, text: 'Foreign injected key' },
      ]);

      await service.activate('el');

      const [, bundle] = translate.setTranslation.mock.calls[0];
      expect(JSON.stringify(bundle)).not.toContain('Foreign injected key');
    });

    it('drops a cached entry whose text contains HTML-significant characters, even for a legitimate key', async () => {
      cache.read.mockResolvedValue([
        { key: 'menu.scan' as UiTextKey, text: '<img src=x onerror=alert(1)>' },
        { key: 'menu.wallet' as UiTextKey, text: 'Cartera' },
      ]);

      await service.activate('el');

      const [, bundle] = translate.setTranslation.mock.calls[0];
      // The tainted entry is dropped, so the pristine value survives the merge (EC-06).
      expect((bundle as { menu: { scan: string } }).menu.scan).toBe('Escáner QR');
      expect((bundle as { menu: { wallet: string } }).menu.wallet).toBe('Cartera');
    });

    it('drops a cached entry whose text is wildly longer than its pristine counterpart', async () => {
      cache.read.mockResolvedValue([
        { key: 'menu.scan' as UiTextKey, text: 'x'.repeat(5000) },
        { key: 'menu.wallet' as UiTextKey, text: 'Cartera' },
      ]);

      await service.activate('el');

      const [, bundle] = translate.setTranslation.mock.calls[0];
      expect((bundle as { menu: { scan: string } }).menu.scan).toBe('Escáner QR');
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

  describe('activate — engine preparation (first-time language-pack download)', () => {
    it('prepares the engine for the native/target pair before translating', async () => {
      await service.activate('el');

      expect(engine.prepare).toHaveBeenCalledWith({ sourceLanguage: 'es', targetLanguage: 'el' }, expect.any(Function));
      expect(engine.prepare.mock.invocationCallOrder[0]).toBeLessThan(engine.translateEntries.mock.invocationCallOrder[0]);
    });

    it('reflects the language-pack download progress while preparing', async () => {
      let reportProgress!: (loaded: number, total: number) => void;
      let finishDownload!: () => void;
      engine.prepare.mockImplementation((_pair, onProgress) => new Promise<void>(resolve => {
        reportProgress = onProgress!;
        finishDownload = resolve;
      }));

      const activation = service.activate('el');
      await flushMicrotasks();
      reportProgress(0.5, 1);
      const duringDownload = service.progress();
      finishDownload();
      await activation;

      expect(duringDownload).toEqual({ phase: 'downloading', fraction: 0.25 });
      expect(service.progress()).toBeNull();
    });

    it('never moves the bar backwards when the engine restarts its download counter for another pack', async () => {
      let reportProgress!: (loaded: number, total: number) => void;
      let finishDownload!: () => void;
      engine.prepare.mockImplementation((_pair, onProgress) => new Promise<void>(resolve => {
        reportProgress = onProgress!;
        finishDownload = resolve;
      }));

      const activation = service.activate('el');
      await flushMicrotasks();
      reportProgress(1, 1);
      reportProgress(0.2, 1);
      const afterSecondPackStarts = service.progress();
      finishDownload();
      await activation;

      expect(afterSecondPackStarts).toEqual({ phase: 'downloading', fraction: 0.5 });
    });

    it('moves to the apply phase, starting where the download phase ended, once the engine is ready', async () => {
      const phases: unknown[] = [];
      engine.translateEntries.mockImplementation(async (entries) => {
        phases.push(service.progress());
        return entries.map((e: { key: UiTextKey; text: string }) => ({ key: e.key, text: `[${e.text}]` }));
      });

      await service.activate('el');

      expect(phases[0]).toEqual({ phase: 'applying', fraction: 0.5 });
    });

    it('shows no progress before the engine is needed', async () => {
      let progressWhileReadingCache: unknown = 'unset';
      cache.read.mockImplementation(async () => {
        progressWhileReadingCache = service.progress();
        return null;
      });

      await service.activate('el');

      expect(progressWhileReadingCache).toBeNull();
    });

    it('ignores download progress reported after the activation was cancelled', async () => {
      let reportProgress!: (loaded: number, total: number) => void;
      engine.prepare.mockImplementation((_pair, onProgress) => new Promise<void>(() => { reportProgress = onProgress!; }));

      service.activate('el');
      await flushMicrotasks();
      service.deactivate();
      reportProgress(0.7, 1);

      expect(service.progress()).toBeNull();
    });

    it('does not prepare the engine on a cache hit', async () => {
      cache.read.mockResolvedValue([{ key: 'menu.scan', text: 'QR' }]);

      await service.activate('el');

      expect(engine.prepare).not.toHaveBeenCalled();
    });

    it('does not apply the stall timeout while the language pack is still downloading', async () => {
      jest.useFakeTimers();
      let finishDownload!: () => void;
      engine.prepare.mockImplementation(() => new Promise<void>(resolve => { finishDownload = resolve; }));

      const activation = service.activate('el');
      await flushMicrotasks();
      jest.advanceTimersByTime(60_000);
      await flushMicrotasks();
      expect(service.status()).toBe('preparing');
      finishDownload();
      await flushMicrotasks();
      await activation;

      expect(service.status()).toBe('active');
    });

    it('falls back to native with status "error" when preparing the engine fails', async () => {
      engine.prepare.mockRejectedValue(new Error('download failed'));

      await service.activate('el');

      expect(service.status()).toBe('error');
      expect(engine.translateEntries).not.toHaveBeenCalled();
      expect(engine.destroy).toHaveBeenCalled();
    });

    it('does not translate nor leave a stale state when cancelled while the language pack downloads', async () => {
      let finishDownload!: () => void;
      engine.prepare.mockImplementation(() => new Promise<void>(resolve => { finishDownload = resolve; }));

      const activation = service.activate('el');
      await flushMicrotasks();
      service.deactivate();
      finishDownload();
      await activation;

      expect(engine.translateEntries).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
      expect(service.targetLanguage()).toBeNull();
      expect(engine.destroy).toHaveBeenCalled();
      expect(prefs.setUiTranslation).toHaveBeenLastCalledWith({ enabled: false, targetLanguage: 'el' });
      expect(prefs.setUiTranslation).not.toHaveBeenCalledWith({ enabled: true, targetLanguage: 'el' });
    });

    it('stays idle and records no failure when the pending preparation rejects after the cancellation', async () => {
      let failDownload!: () => void;
      engine.prepare.mockImplementation(() => new Promise<void>((_resolve, reject) => {
        failDownload = () => reject(new Error('download interrupted'));
      }));

      const activation = service.activate('el');
      await flushMicrotasks();
      service.deactivate();
      failDownload();
      await activation;

      expect(service.status()).toBe('idle');
      expect(telemetry.track).not.toHaveBeenCalledWith('ui_translation_engine_failed', expect.anything());
    });
  });

  describe('activate — stall timeout (ES-05)', () => {
    it('keeps a slow translation alive as long as batches keep completing', async () => {
      jest.useFakeTimers();
      let batchDone!: (done: number, total: number) => void;
      let finishTranslation!: () => void;
      engine.translateEntries.mockImplementation((entries, _pair, _allowedKeys, onProgress) => new Promise(resolve => {
        batchDone = onProgress!;
        finishTranslation = () => resolve(entries.map((e: { key: UiTextKey; text: string }) => ({ key: e.key, text: `[${e.text}]` })));
      }));

      const activation = service.activate('el');
      await flushMicrotasks();
      jest.advanceTimersByTime(25_000);
      batchDone(1, 2);
      jest.advanceTimersByTime(25_000); // 50 s in total, but never 30 s without a batch
      await flushMicrotasks();
      expect(service.status()).toBe('preparing');
      finishTranslation();
      await activation;

      expect(service.status()).toBe('active');
    });

    it('fails once no batch completes for TRANSLATION_STALL_TIMEOUT_MS even after earlier progress', async () => {
      jest.useFakeTimers();
      let batchDone!: (done: number, total: number) => void;
      engine.translateEntries.mockImplementation((_entries, _pair, _allowedKeys, onProgress) => new Promise(() => {
        batchDone = onProgress!;
      }));

      const activation = service.activate('el');
      await flushMicrotasks();
      jest.advanceTimersByTime(20_000);
      batchDone(1, 2);
      jest.advanceTimersByTime(30_000);
      await activation;

      expect(service.status()).toBe('error');
    });

    it('falls back to native and destroys the engine when the translation never completes a batch within TRANSLATION_STALL_TIMEOUT_MS', async () => {
      jest.useFakeTimers();
      engine.translateEntries.mockImplementation(() => new Promise(() => { /* never resolves */ }));

      const activation = service.activate('el');
      // Flush the fetch + cache-read microtasks so doActivate() reaches the
      // engine call and withStallGuard()'s timer is armed before we advance it.
      await flushMicrotasks();
      jest.advanceTimersByTime(30_000);
      await activation;

      expect(service.status()).toBe('error');
      expect(engine.destroy).toHaveBeenCalled();
      expect(document.documentElement.lang).toBe('es');
    });
  });

  describe('activate — failure telemetry (root-cause diagnosis)', () => {
    it('records only the error name when preparing the engine fails', async () => {
      engine.prepare.mockRejectedValue(new DOMException('needs a user gesture', 'NotAllowedError'));

      await service.activate('el');

      expect(telemetry.track).toHaveBeenCalledWith('ui_translation_engine_failed', {
        targetLanguage: 'el',
        errorName: 'NotAllowedError',
      });
    });

    it('records a dedicated error name when the translation stalls', async () => {
      jest.useFakeTimers();
      engine.translateEntries.mockImplementation(() => new Promise(() => { /* never resolves */ }));

      const activation = service.activate('el');
      await flushMicrotasks();
      jest.advanceTimersByTime(30_000);
      await activation;

      expect(telemetry.track).toHaveBeenCalledWith('ui_translation_engine_failed', {
        targetLanguage: 'el',
        errorName: 'TranslationStalledError',
      });
    });

    it('records a generic name when the failure is not an Error instance', async () => {
      engine.prepare.mockRejectedValue('boom');

      await service.activate('el');

      expect(telemetry.track).toHaveBeenCalledWith('ui_translation_engine_failed', {
        targetLanguage: 'el',
        errorName: 'UnknownError',
      });
    });
  });

  describe('activate — concurrency (EC-07, ES-03)', () => {
    it('keeps coalescing the same target after a cancelled operation settles late', async () => {
      let finishFirstDownload!: () => void;
      engine.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { finishFirstDownload = resolve; }));

      const cancelled = service.activate('el');
      await flushMicrotasks();
      service.deactivate();
      let finishSecondDownload!: () => void;
      engine.prepare.mockImplementationOnce(() => new Promise<void>(resolve => { finishSecondDownload = resolve; }));
      const reactivated = service.activate('el');
      await flushMicrotasks();
      finishFirstDownload(); // the cancelled operation settles while the new one is still preparing
      await cancelled;
      const coalesced = service.activate('el');
      finishSecondDownload();
      await Promise.all([reactivated, coalesced]);

      expect(coalesced).toBe(reactivated);
      expect(engine.prepare).toHaveBeenCalledTimes(2);
      expect(engine.translateEntries).toHaveBeenCalledTimes(1);
      expect(service.status()).toBe('active');
    });

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

      await flushMicrotasks();
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
      await flushMicrotasks();

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

    it('rejects a persisted target that is not one of the candidate languages (security-auditor full-mode review, EUD-142 F7)', async () => {
      prefsStore = { enabled: true, targetLanguage: 'not-a-real-lang' };

      await service.restoreFromPreference();

      expect(engine.translateEntries).not.toHaveBeenCalled();
      expect(service.status()).toBe('idle');
    });

    it('rejects a natively-supported language smuggled in as a translation target (es/en/ca are never candidates, AC-07)', async () => {
      prefsStore = { enabled: true, targetLanguage: 'es' };

      await service.restoreFromPreference();

      expect(engine.translateEntries).not.toHaveBeenCalled();
    });

    describe('user-activation gate (Translator.create() needs a real gesture on a cold load)', () => {
      let originalUserActivation: PropertyDescriptor | undefined;

      beforeEach(() => {
        originalUserActivation = Object.getOwnPropertyDescriptor(navigator, 'userActivation');
      });

      afterEach(() => {
        if (originalUserActivation) {
          Object.defineProperty(navigator, 'userActivation', originalUserActivation);
        } else {
          delete (navigator as { userActivation?: unknown }).userActivation;
        }
      });

      it('activates immediately when the page already has user activation', async () => {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          value: { hasBeenActive: true, isActive: true },
        });
        prefsStore = { enabled: true, targetLanguage: 'el' };

        await service.restoreFromPreference();

        expect(service.status()).toBe('active');
      });

      it('waits for the first pointerdown before activating when there has been no interaction yet', async () => {
        Object.defineProperty(navigator, 'userActivation', {
          configurable: true,
          value: { hasBeenActive: false, isActive: false },
        });
        prefsStore = { enabled: true, targetLanguage: 'el' };

        const restored = service.restoreFromPreference();
        await Promise.resolve(); await Promise.resolve();
        expect(service.status()).toBe('idle'); // still waiting — no interaction yet

        document.dispatchEvent(new Event('pointerdown'));
        await restored;

        expect(service.status()).toBe('active');
      });

      it('falls through immediately when the User-Activation API is not available at all', async () => {
        delete (navigator as { userActivation?: unknown }).userActivation;
        prefsStore = { enabled: true, targetLanguage: 'el' };

        await service.restoreFromPreference();

        expect(service.status()).toBe('active');
      });
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
