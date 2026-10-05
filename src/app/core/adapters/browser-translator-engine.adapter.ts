import { Injectable, inject } from '@angular/core';

import { TRANSLATION_CHUNK_SIZE } from '../constants/ui-translation.constants';
import { TranslationAvailability, UiTextEntry, UiTextKey } from '../models/ui-text-translation.model';
import { LanguagePair, TranslationEnginePort } from '../ports/translation-engine.port';
import { isExcludedKey } from '../../shared/helpers/ui-text-bundle';
import { TelemetryService } from '../services/telemetry.service';

/**
 * Production `TranslationEnginePort` adapter (EUD-142, AD-1: on-device
 * strict). **The only file in the codebase that references the browser's
 * `Translator` API** — every other translation-layer file talks to the port,
 * never to this global directly. That concentration is what makes the
 * spoofing mitigation in `technical-design.md` §3.4.1 (STRIDE) meaningful:
 * a code reviewer only has one file to audit for engine selection
 */
@Injectable()
export class BrowserTranslatorEngineAdapter implements TranslationEnginePort {
  private readonly telemetry = inject(TelemetryService);

  /** Memoized `Translator` instance promise per `source:target` pair (`??=`, same idiom as `WalletDiscoveryService`). */
  private readonly _translatorFor = new Map<string, Promise<TranslatorInstance>>();

  /** Aborts the pending `Translator.create` (language-pack download) of each pair on `destroy()`. */
  private readonly _abortFor = new Map<string, AbortController>();

  isSupported(): boolean {
    return typeof Translator !== 'undefined' && 'availability' in Translator;
  }

  async availability(pair: LanguagePair): Promise<TranslationAvailability> {
    if (!this.isSupported()) {
      return 'unavailable';
    }
    try {
      return await Translator.availability({
        sourceLanguage: pair.sourceLanguage,
        targetLanguage: pair.targetLanguage,
      });
    } catch {
      // Engine present but the probe itself failed — treat as unavailable
      // rather than propagating (EC-01 degrades gracefully either way).
      return 'unavailable';
    }
  }

  async prepare(pair: LanguagePair, onDownloadProgress?: (loaded: number, total: number) => void): Promise<void> {
    await this.translatorFor(pair, onDownloadProgress);
  }

  async translateEntries(
    entries: ReadonlyArray<UiTextEntry>,
    pair: LanguagePair,
    allowedKeys: ReadonlySet<UiTextKey>,
    onProgress?: (done: number, total: number) => void,
  ): Promise<ReadonlyArray<UiTextEntry>> {
    // ES-01 — fail-closed guard (control 3/4 of the FR-25/NFR-Pr-03 privacy
    // boundary), checked against BOTH halves of the contract: (1) the key
    // must belong to `allowedKeys` — the set the caller derived from the
    // *current* pristine bundle — and (2) it must not fall under an excluded
    // prefix (redundant with (1) in practice, since the caller already
    // excludes those, but kept as a self-contained check that doesn't rely
    // on the caller having filtered correctly). `entries` can only ever
    // contain real UiTextEntry values — the nominal-branded UiTextKey is
    // producible only by flattenUiBundle() (control 1/4) and this signature
    // only accepts UiTextEntry (control 2/4) — but a single key slipping
    // through (e.g. a future caller forgetting to filter, or a tampered
    // allowedKeys/entries pair) still aborts the WHOLE batch rather than
    // translating everything except that one entry: the rejected text
    // itself is never logged, only the fact that a rejection happened.
    const rejected = entries.some(entry => !allowedKeys.has(entry.key) || isExcludedKey(entry.key));
    if (rejected) {
      this.telemetry.track('ui_translation_rejected_entry', {
        sourceLanguage: pair.sourceLanguage,
        targetLanguage: pair.targetLanguage,
      });
      throw new Error('BrowserTranslatorEngineAdapter: rejected entry outside the allowed key set');
    }

    if (entries.length === 0) {
      return [];
    }

    const translator = await this.translatorFor(pair);
    const total = entries.length;
    const results: UiTextEntry[] = [];

    for (let start = 0; start < entries.length; start += TRANSLATION_CHUNK_SIZE) {
      const chunk = entries.slice(start, start + TRANSLATION_CHUNK_SIZE);
      // Chunks run sequentially on purpose: bounds concurrent calls to the on-device translator and drives onProgress.
      const translatedChunk = await Promise.all( // NOSONAR typescript:S9382
        chunk.map(async entry => ({ key: entry.key, text: await translator.translate(entry.text) })),
      );
      results.push(...translatedChunk);
      onProgress?.(results.length, total);
    }

    return results;
  }

  destroy(): void {
    for (const controller of this._abortFor.values()) {
      controller.abort();
    }
    this._abortFor.clear();
    for (const translatorPromise of this._translatorFor.values()) {
      translatorPromise.then(translator => translator.destroy()).catch(() => {
        // Creation never resolved — nothing to release.
      });
    }
    this._translatorFor.clear();
  }

  private translatorFor(
    pair: LanguagePair,
    onDownloadProgress?: (loaded: number, total: number) => void,
  ): Promise<TranslatorInstance> {
    const cacheKey = `${pair.sourceLanguage}:${pair.targetLanguage}`;
    let memoized = this._translatorFor.get(cacheKey);
    if (!memoized) {
      const controller = new AbortController();
      this._abortFor.set(cacheKey, controller);
      memoized = this.createTranslator(pair, controller.signal, onDownloadProgress);
      this._translatorFor.set(cacheKey, memoized);
    }
    return memoized;
  }

  private createTranslator(
    pair: LanguagePair,
    signal: AbortSignal,
    onDownloadProgress?: (loaded: number, total: number) => void,
  ): Promise<TranslatorInstance> {
    return Translator.create({
      sourceLanguage: pair.sourceLanguage,
      targetLanguage: pair.targetLanguage,
      signal,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', event => {
          onDownloadProgress?.(event.loaded, event.total);
        });
      },
    });
  }
}
