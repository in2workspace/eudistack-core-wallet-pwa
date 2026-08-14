import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, firstValueFrom, from, switchMap, timeout } from 'rxjs';

import {
  BUNDLE_FETCH_TIMEOUT_MS, RTL_LANGUAGE_TAGS, RUNTIME_TRANSLATION_CANDIDATE_LANGUAGES, TRANSLATION_BUDGET_MS,
} from '../constants/ui-translation.constants';
import { LanguageTag, SCHEMA_VERSION, UiTextEntry, UiTextKey, UiTranslationStatus } from '../models/ui-text-translation.model';
import { TRANSLATION_ENGINE } from '../ports/translation-engine.port';
import {
  UiTextBundle, flattenUiBundle, hasIntactPlaceholders, hashUiBundle, inflateUiBundle,
  isExcludedKey, maskPlaceholders, mergeUiBundles, unmaskPlaceholders,
} from '../../shared/helpers/ui-text-bundle';
import { UserPreferencesService } from '../../shared/services/user-preferences.service';
import { UiTranslationCacheService } from './ui-translation-cache.service';
import { TelemetryService } from './telemetry.service';

/** Progress snapshot for the current activation (AC-11). `null` when idle/active/error. */
export interface UiTranslationProgress {
  readonly done: number;
  readonly total: number;
}

/**
 * Orchestrator for runtime UI translation (EUD-142). `providedIn: 'root'` —
 * one instance for the app's lifetime, independent of page navigation
 * (EC-08). Coordinates the full flow described in `technical-design.md`
 * §3.4: fetch the pristine bundle → flatten/exclude → cache lookup → engine
 * (on miss) → unmask + validate → **one atomic** `setTranslation()` → sync
 * `lang`/`dir` → persist preference.
 *
 * State machine (`status`): `idle → probing → preparing → active`, with
 * `unavailable` (no engine) and `error` (last attempt failed) as terminal-
 * ish states reachable from `preparing`. A monotonic generation counter
 * discards the result of any superseded operation (ES-03/EC-07).
 */
@Injectable({ providedIn: 'root' })
export class UiTextTranslationService {
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly cache = inject(UiTranslationCacheService);
  private readonly engine = inject(TRANSLATION_ENGINE);
  private readonly prefs = inject(UserPreferencesService);
  private readonly telemetry = inject(TelemetryService);
  private readonly document = inject(DOCUMENT);

  private readonly _status = signal<UiTranslationStatus>('idle');
  private readonly _targetLanguage = signal<LanguageTag | null>(null);
  private readonly _progress = signal<UiTranslationProgress | null>(null);
  private readonly _availableTargets = signal<ReadonlyArray<LanguageTag>>([]);

  readonly status = this._status.asReadonly();
  readonly targetLanguage = this._targetLanguage.asReadonly();
  readonly progress = this._progress.asReadonly();
  readonly availableTargets = this._availableTargets.asReadonly();

  /** Monotonic generation counter — a stale async step never mutates state (ES-03). */
  private _generation = 0;
  /** In-flight activation, reused by a concurrent `activate()` call for the SAME target (EC-07). */
  private _operation: Promise<void> | null = null;
  /** Target the in-flight `_operation` is preparing — lets a call for a DIFFERENT target supersede it instead of being silently coalesced away. */
  private _inFlightTarget: LanguageTag | null = null;
  /** Probe result, memoized once per session (EC-02). */
  private _probePromise: Promise<ReadonlyArray<LanguageTag>> | null = null;
  /** In-memory copy of the last-fetched pristine bundle — lets `deactivate()` restore the native UI with 0 network requests (NFR-S-142-03). */
  private _pristineBundle: UiTextBundle | null = null;

  constructor() {
    // AD-6 (incidental fix) + ES-03: keep documentElement.lang/dir synced with
    // whichever language is effectively shown. If translation is engaged,
    // recompute it from the new native source (switchMap: a later native-
    // language change supersedes an in-flight recompute — never mergeMap).
    // Otherwise, just sync lang/dir to the new native language.
    this.translate.onLangChange.pipe(
      switchMap(event => {
        const target = this._targetLanguage();
        const isEngaged = this._status() === 'active' || this._status() === 'preparing';
        if (target && isEngaged) {
          return from(this.activate(target));
        }
        this.document.documentElement.lang = event.lang;
        this.document.documentElement.dir = 'ltr';
        return EMPTY;
      }),
    ).subscribe();
  }

  /**
   * Probes engine support and, if supported, every candidate pair against
   * the current native language — memoized for the session (EC-02). Sets
   * `status` to `'unavailable'` when the engine is absent or no candidate
   * is translatable, `'idle'` otherwise.
   */
  probeAvailability(): Promise<ReadonlyArray<LanguageTag>> {
    this._probePromise ??= this.runProbe();
    return this._probePromise;
  }

  /**
   * Activates translation to `target`. Idempotent while already preparing
   * for the SAME target — a concurrent call reuses the in-flight operation
   * (EC-07: double activation during preparation). A call for a DIFFERENT
   * target while one is in flight supersedes it instead of being coalesced
   * away: the stale operation's own generation check makes its eventual
   * completion a no-op (ES-03), so it never overwrites the newer choice —
   * without this, picking a different language before the first one
   * finishes preparing silently persisted the discarded choice instead.
   * Bounded to `TRANSLATION_BUDGET_MS` (ES-05); on timeout or any failure,
   * falls back to the native language (`status = 'error'`).
   */
  activate(target: LanguageTag): Promise<void> {
    if (this._operation && this._inFlightTarget === target) {
      return this._operation;
    }
    const generation = ++this._generation;
    this._inFlightTarget = target;
    this._operation = this.runActivation(target, generation).finally(() => {
      if (this._inFlightTarget === target) {
        this._operation = null;
        this._inFlightTarget = null;
      }
    });
    return this._operation;
  }

  /**
   * Deactivates immediately, with zero network requests (AC-05, NFR-S-142-03):
   * restores the native UI from the in-memory pristine bundle, resets
   * `lang`/`dir`, releases the engine, and persists the preference.
   */
  deactivate(): void {
    this._generation++; // invalidate any in-flight activation
    this._operation = null;
    this._inFlightTarget = null;
    const lastTarget = this._targetLanguage();
    this.engine.destroy();
    this.restoreNativeLanguageDisplay();
    this._status.set('idle');
    this._targetLanguage.set(null);
    this._progress.set(null);
    // Remembers the last target so re-enabling defaults to the same language;
    // FR-26 is satisfied purely by `enabled: false` gating activation.
    this.prefs.setUiTranslation({ enabled: false, targetLanguage: lastTarget });
    this.telemetry.track('ui_translation_disabled', {});
  }

  /** Re-activates the persisted preference, if any — call once at startup (AC-06). */
  async restoreFromPreference(): Promise<void> {
    const pref = this.prefs.uiTranslation();
    if (pref.enabled && pref.targetLanguage) {
      await this.activate(pref.targetLanguage);
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async runProbe(): Promise<ReadonlyArray<LanguageTag>> {
    if (!this.engine.isSupported()) {
      this._status.set('unavailable');
      this._availableTargets.set([]);
      return [];
    }
    this._status.set('probing');
    const source = this.currentNativeLang();

    const probed = await Promise.all(
      RUNTIME_TRANSLATION_CANDIDATE_LANGUAGES.map(async target => ({
        target,
        availability: await this.engine.availability({ sourceLanguage: source, targetLanguage: target }),
      })),
    );
    const available = probed
      .filter(p => p.availability === 'available' || p.availability === 'downloadable')
      .map(p => p.target);

    this._availableTargets.set(available);
    this._status.set(available.length > 0 ? 'idle' : 'unavailable');
    return available;
  }

  private async runActivation(target: LanguageTag, generation: number): Promise<void> {
    this._status.set('preparing');
    this._targetLanguage.set(target);
    this._progress.set({ done: 0, total: 0 });

    try {
      await this.withBudget(this.doActivate(target, generation));
    } catch {
      if (!this.isCurrentGeneration(generation)) {
        return; // superseded — the newer operation owns the visible state
      }
      this._generation++; // invalidate any still-running step of this attempt
      this._status.set('error');
      this._progress.set(null);
      this.engine.destroy();
      this.restoreNativeLanguageDisplay();
      this.telemetry.track('ui_translation_engine_failed', { targetLanguage: target });
    }
  }

  private async doActivate(target: LanguageTag, generation: number): Promise<void> {
    const nativeLang = this.currentNativeLang();

    // 1. Fetch the pristine bundle — same-origin, Service-Worker-cached (ES-02).
    const bundleJson = await firstValueFrom(
      this.http.get(`assets/i18n/${nativeLang}.json`, { responseType: 'text' }).pipe(
        timeout(BUNDLE_FETCH_TIMEOUT_MS),
      ),
    );
    if (!this.isCurrentGeneration(generation)) return;

    const pristineBundle = JSON.parse(bundleJson) as UiTextBundle;
    this._pristineBundle = pristineBundle;
    const bundleHash = hashUiBundle(bundleJson);

    // 2. Flatten + exclude (AD-3 deny-list; provenance guarantee from flattenUiBundle).
    const translatableEntries = flattenUiBundle(pristineBundle).filter(e => !isExcludedKey(e.key));

    // 3. Cache lookup (EC-04: a hit means the engine is never invoked).
    const allowedKeys = new Set(translatableEntries.map(e => e.key));
    let translatedEntries = await this.cache.read(nativeLang, target, bundleHash);
    if (!this.isCurrentGeneration(generation)) return;

    if (translatedEntries) {
      // Defense-in-depth (security screen, /verify EUD-142 finding F2):
      // isCachedUiTranslation() only validates shape, not that a key belongs
      // to the current pristine bundle. A record that reached storage
      // through anything other than this service's own write() — e.g.
      // direct IndexedDB tampering on a compromised/shared device — could
      // otherwise inject a foreign key into the merged bundle via
      // mergeUiBundles(). Re-derive trust from the pristine bundle on every
      // read, regardless of provenance.
      translatedEntries = translatedEntries.filter(e => allowedKeys.has(e.key));
    } else {
      translatedEntries = await this.translateViaEngine(translatableEntries, nativeLang, target, generation, allowedKeys);
      if (!this.isCurrentGeneration(generation)) return;

      await this.cache.write({
        schemaVersion: SCHEMA_VERSION,
        sourceLang: nativeLang,
        targetLang: target,
        bundleHash,
        entries: translatedEntries,
        lastUsedAt: Date.now(),
      });
      if (!this.isCurrentGeneration(generation)) return;
    }

    // 4. Merge over the pristine bundle and apply ATOMICALLY (ES-04) — a
    // single setTranslation() call with the fully-built bundle; no partial
    // application is ever visible.
    const merged = mergeUiBundles(pristineBundle, inflateUiBundle(translatedEntries));
    if (!this.isCurrentGeneration(generation)) return;

    this.translate.setTranslation(nativeLang, merged, false);
    this.document.documentElement.lang = target;
    this.document.documentElement.dir = RTL_LANGUAGE_TAGS.includes(target) ? 'rtl' : 'ltr';

    this._status.set('active');
    this._progress.set(null);
    this.prefs.setUiTranslation({ enabled: true, targetLanguage: target });
    this.telemetry.track('ui_translation_enabled', { targetLanguage: target });
  }

  /** Masks placeholders, invokes the engine, unmasks, and validates marker integrity per key (AC-14, ES-06). */
  private async translateViaEngine(
    entries: ReadonlyArray<UiTextEntry>,
    sourceLanguage: LanguageTag,
    targetLanguage: LanguageTag,
    generation: number,
    allowedKeys: ReadonlySet<UiTextKey>,
  ): Promise<ReadonlyArray<UiTextEntry>> {
    const maskedEntries = entries.map(e => ({ key: e.key, text: maskPlaceholders(e.text) }));

    const rawTranslated = await this.engine.translateEntries(
      maskedEntries,
      { sourceLanguage, targetLanguage },
      allowedKeys,
      (done, total) => {
        if (this.isCurrentGeneration(generation)) {
          this._progress.set({ done, total });
        }
      },
    );

    const byKey = new Map(entries.map(e => [e.key, e.text]));
    return rawTranslated.map(translated => {
      const originalText = byKey.get(translated.key) ?? '';
      const unmasked = unmaskPlaceholders(translated.text);
      if (!hasIntactPlaceholders(originalText, unmasked)) {
        this.telemetry.track('ui_translation_placeholder_mismatch', { targetLanguage });
        return { key: translated.key, text: originalText }; // fall back to native for this key
      }
      return { key: translated.key, text: unmasked };
    });
  }

  /** Restores the native UI from the in-memory pristine bundle — 0 network requests (NFR-S-142-03). */
  private restoreNativeLanguageDisplay(): void {
    const nativeLang = this.currentNativeLang();
    if (this._pristineBundle) {
      this.translate.setTranslation(nativeLang, this._pristineBundle, false);
    }
    this.document.documentElement.lang = nativeLang;
    this.document.documentElement.dir = 'ltr';
  }

  private currentNativeLang(): LanguageTag {
    return this.translate.currentLang || this.translate.getDefaultLang();
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this._generation;
  }

  /** Races `operation` against `TRANSLATION_BUDGET_MS` (ES-05) — rejects without cancelling the underlying work; generation guards make any late result a no-op. */
  private withBudget<T>(operation: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('ui-translation: activation exceeded TRANSLATION_BUDGET_MS')),
        TRANSLATION_BUDGET_MS,
      );
      operation.then(
        value => { clearTimeout(timer); resolve(value); },
        err => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
