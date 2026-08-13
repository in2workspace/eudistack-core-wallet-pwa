import { InjectionToken } from '@angular/core';

import { LanguageTag, TranslationAvailability, UiTextEntry } from '../models/ui-text-translation.model';

/** Source/target language pair, mirroring the Translator API's own shape. */
export interface LanguagePair {
  readonly sourceLanguage: LanguageTag;
  readonly targetLanguage: LanguageTag;
}

/**
 * Port (application layer) for the on-device browser translation engine
 * (EUD-142, AD-1: on-device strict — the app never invokes a translation
 * endpoint).
 *
 * **Privacy boundary.** The signature only accepts `UiTextEntry`, whose `key`
 * is the nominal-branded `UiTextKey` produced solely by `flattenUiBundle()`
 * (task 8). A caller cannot pass arbitrary text — e.g. credential content —
 * to `translateEntries()` without defeating that type explicitly. This is
 * control 2/4 of the FR-25/NFR-Pr-03 privacy boundary (see
 * `technical-design.md` §3.4.1); control 3/4 (the runtime fail-closed guard,
 * ES-01) lives in the implementation, not in this interface.
 *
 * Implementations:
 *  - Production: `BrowserTranslatorEngineAdapter` (task 11)
 *  - Tests:      inline fake via `{ provide: TRANSLATION_ENGINE, useValue: fakeEngine }`
 */
export interface TranslationEnginePort {
  /**
   * Synchronous capability check — `typeof Translator !== 'undefined' && 'availability' in Translator`.
   * Detection by capability, not by user-agent (EC-01): when a browser
   * exposes the engine, the feature enables itself without a code change.
   */
  isSupported(): boolean;

  /**
   * Probes whether `pair` can be translated on this device. There is no
   * engine API to enumerate supported languages (EC-02), so callers probe
   * candidate pairs individually and memoize the result for the session.
   */
  availability(pair: LanguagePair): Promise<TranslationAvailability>;

  /**
   * Translates `entries` for `pair`, invoking `onProgress` as batches
   * complete (AC-11). Rejects (and translates nothing) if any entry's key
   * does not belong to the release i18n bundle or falls under
   * `RUNTIME_TRANSLATION_EXCLUDED_KEY_PREFIXES` — fail-closed, ES-01.
   */
  translateEntries(
    entries: ReadonlyArray<UiTextEntry>,
    pair: LanguagePair,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ReadonlyArray<UiTextEntry>>;

  /** Releases the underlying engine resource (ES-04/ES-05, table row 6 of §3.4.2). */
  destroy(): void;
}

/**
 * DI token for `TranslationEnginePort`.
 *
 * Register in providers:
 * ```ts
 * { provide: TRANSLATION_ENGINE, useClass: BrowserTranslatorEngineAdapter }
 * ```
 *
 * Override in tests:
 * ```ts
 * { provide: TRANSLATION_ENGINE, useValue: fakeEngine }
 * ```
 */
export const TRANSLATION_ENGINE = new InjectionToken<TranslationEnginePort>('TRANSLATION_ENGINE');
