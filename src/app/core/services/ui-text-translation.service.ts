import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { EMPTY, firstValueFrom, from, switchMap, timeout } from 'rxjs';

import {
  BUNDLE_FETCH_TIMEOUT_MS, DEFAULT_NATIVE_LANGUAGES, DOWNLOAD_PROGRESS_WEIGHT, RTL_LANGUAGE_TAGS, RUNTIME_TRANSLATION_CANDIDATE_LANGUAGES,
  TRANSLATION_SOURCE_LANGUAGE, TRANSLATION_STALL_TIMEOUT_MS,
} from '../constants/ui-translation.constants';
import { LanguageTag, SCHEMA_VERSION, UiTextEntry, UiTextKey, UiTranslationStatus } from '../models/ui-text-translation.model';
import { TRANSLATION_ENGINE } from '../ports/translation-engine.port';
import {
  UiTextBundle, flattenUiBundle, hasIntactPlaceholders, hashUiBundle, inflateUiBundle,
  isExcludedKey, isSafeTranslatedText, maskPlaceholders, mergeUiBundles, unmaskPlaceholders,
} from '../../shared/helpers/ui-text-bundle';
import { UserPreferencesService } from '../../shared/services/user-preferences.service';
import { ThemeService } from './theme.service';
import { UiTranslationCacheService } from './ui-translation-cache.service';
import { TelemetryService } from './telemetry.service';

/**
 * Progress snapshot for the current activation (AC-11): a single bar that
 * only moves forward, split into a download phase and an apply phase.
 * `null` when idle/active/error, or before the engine is first needed.
 */
export interface UiTranslationProgress {
  readonly phase: 'downloading' | 'applying';
  /** Overall progress in the 0..1 range; never decreases within an activation. */
  readonly fraction: number;
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
  private readonly theme = inject(ThemeService);
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
  /** Probe result, memoized once per session (EC-02): every pair starts from `TRANSLATION_SOURCE_LANGUAGE`, so it never depends on the native language. */
  private _probePromise: Promise<ReadonlyArray<LanguageTag>> | null = null;
  /**
   * In-memory copy of the native bundle taken at activation, with the language it belongs to — lets
   * `deactivate()` restore the native UI with 0 network requests (NFR-S-142-03). The language is kept
   * so a copy taken under a previous native language is never restored over the current one.
   */
  private _nativeBundle: { readonly lang: LanguageTag; readonly bundle: UiTextBundle } | null = null;

  constructor() {
    // AD-6 (incidental fix) + ES-03: keep documentElement.lang/dir synced with
    // whichever language is effectively shown. If translation is engaged,
    // recompute it from the new native source (switchMap: a later native-
    // language change supersedes an in-flight recompute — never mergeMap).
    // Otherwise, just sync lang/dir to the new native language.
    this.translate.onLangChange.pipe(
      switchMap(event => {
        const target = this._targetLanguage();
        if (target && this.isEngaged()) {
          return from(this.activate(target));
        }
        this.document.documentElement.lang = event.lang;
        this.document.documentElement.dir = 'ltr';
        return EMPTY;
      }),
    ).subscribe();
  }

  /**
   * Probes engine support and, if supported, every candidate pair from
   * `TRANSLATION_SOURCE_LANGUAGE` — memoized for the session (EC-02). Sets
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
   * The translation step fails once it stalls for `TRANSLATION_STALL_TIMEOUT_MS`
   * without completing a batch (ES-05); the
   * engine preparation (first-time language-pack download) is not, since it
   * can legitimately take longer — the user can cancel it via `deactivate()`.
   * On timeout or any failure, falls back to the native language
   * (`status = 'error'`).
   */
  activate(target: LanguageTag): Promise<void> {
    if (this._operation && this._inFlightTarget === target) {
      return this._operation;
    }
    const generation = ++this._generation;
    this._inFlightTarget = target;
    // Identity (not target) decides ownership: a cancelled operation that
    // settles late must not clear a newer one started for the SAME target.
    const operation: Promise<void> = this.runActivation(target, generation).finally(() => {
      if (this._operation === operation) {
        this._operation = null;
        this._inFlightTarget = null;
      }
    });
    this._operation = operation;
    return operation;
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

  /**
   * Re-activates the persisted preference, if any — call once at startup
   * (AC-06). Waits for the page's first genuine user interaction before
   * calling `activate()` if it hasn't happened yet: `Translator.create()`
   * requires user activation for the initial (uncached) engine/model setup,
   * which an APP_INITIALIZER firing on a cold, untouched load never has.
   * Observed live: calling this unconditionally at boot left the login
   * screen stuck on the native language until the Holder actually
   * interacted with the page (e.g. by logging in) — this gate makes that
   * deterministic instead of accidental.
   *
   * Waits for the theme first: it registers the tenant's languages and sets the
   * native one, and APP_INITIALIZERs run concurrently, so reading them earlier
   * would mistake a language the tenant does not load for a native one.
   */
  async restoreFromPreference(): Promise<void> {
    const pref = this.prefs.uiTranslation();
    if (!pref.enabled || !pref.targetLanguage) {
      return;
    }
    await this.theme.ready;
    // Defence-in-depth (security-auditor full-mode review, EUD-142 F7): the
    // preference is user-editable storage — reject a target that isn't one
    // of the actual candidate languages before it can reach
    // documentElement.lang / Translator.create().
    if (!this.candidateLanguages().includes(pref.targetLanguage)) {
      return;
    }
    await this.waitForUserActivation();
    await this.activate(pref.targetLanguage);
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Resolves immediately if the page already has user activation; otherwise waits for the first pointerdown/keydown. */
  private waitForUserActivation(): Promise<void> {
    if (typeof navigator === 'undefined' || !('userActivation' in navigator)) {
      return Promise.resolve(); // API not supported here — nothing to gate on.
    }
    if (navigator.userActivation.hasBeenActive) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const onInteract = (): void => {
        this.document.removeEventListener('pointerdown', onInteract, true);
        this.document.removeEventListener('keydown', onInteract, true);
        resolve();
      };
      this.document.addEventListener('pointerdown', onInteract, { capture: true, once: true });
      this.document.addEventListener('keydown', onInteract, { capture: true, once: true });
    });
  }

  private async runProbe(): Promise<ReadonlyArray<LanguageTag>> {
    if (!this.engine.isSupported()) {
      this._status.set('unavailable');
      this._availableTargets.set([]);
      return [];
    }
    if (!this.isEngaged()) {
      this._status.set('probing');
    }

    const probed = await Promise.all(
      this.candidateLanguages().map(async target => ({
        target,
        availability: await this.engine.availability({ sourceLanguage: TRANSLATION_SOURCE_LANGUAGE, targetLanguage: target }),
      })),
    );
    const available = probed
      .filter(p => p.availability === 'available' || p.availability === 'downloadable')
      .map(p => p.target);

    this._availableTargets.set(available);
    if (!this.isEngaged()) {
      this._status.set(available.length > 0 ? 'idle' : 'unavailable');
    }
    return available;
  }

  private isEngaged(): boolean {
    return this._status() === 'active' || this._status() === 'preparing';
  }

  private async runActivation(target: LanguageTag, generation: number): Promise<void> {
    this._status.set('preparing');
    this._targetLanguage.set(target);
    this._progress.set(null);

    try {
      await this.doActivate(target, generation);
    } catch (error) {
      if (!this.isCurrentGeneration(generation)) {
        return; // superseded — the newer operation owns the visible state
      }
      this._generation++; // invalidate any still-running step of this attempt
      this._status.set('error');
      this._progress.set(null);
      this.engine.destroy();
      this.restoreNativeLanguageDisplay();
      this.telemetry.track('ui_translation_engine_failed', {
        targetLanguage: target,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  private async doActivate(target: LanguageTag, generation: number): Promise<void> {
    const nativeLang = this.currentNativeLang();

    // 1. Fetch the pristine source bundle (always English) plus, when the native
    // language differs, the native one to restore on deactivation — same-origin,
    // Service-Worker-cached (ES-02).
    const sourceJson = await this.fetchBundle(TRANSLATION_SOURCE_LANGUAGE);
    const nativeJson = nativeLang === TRANSLATION_SOURCE_LANGUAGE ? sourceJson : await this.fetchBundle(nativeLang);
    if (!this.isCurrentGeneration(generation)) return;

    const pristineBundle = JSON.parse(sourceJson) as UiTextBundle;
    const nativeBundle = JSON.parse(nativeJson) as UiTextBundle;
    this._nativeBundle = { lang: nativeLang, bundle: nativeBundle };
    const bundleHash = hashUiBundle(sourceJson);

    // 2. Flatten + exclude (AD-3 deny-list; provenance guarantee from flattenUiBundle).
    const translatableEntries = flattenUiBundle(pristineBundle).filter(e => !isExcludedKey(e.key));

    // 3. Cache lookup (EC-04: a hit means the engine is never invoked).
    const allowedKeys = new Set(translatableEntries.map(e => e.key));
    let translatedEntries = await this.cache.read(TRANSLATION_SOURCE_LANGUAGE, target, bundleHash);
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
      //
      // Key validation alone is not enough (security-auditor full-mode
      // review, EUD-142 F2): allowedKeys constrains which KEYS may be
      // merged, but says nothing about the TEXT paired with a legitimate
      // key — a tampered record could carry arbitrary text (incl. markup)
      // for a real key. isSafeTranslatedText() bounds that text against its
      // pristine counterpart before it ever reaches setTranslation().
      const pristineByKey = new Map(translatableEntries.map(e => [e.key, e.text]));
      translatedEntries = translatedEntries.filter(e => {
        const pristineText = pristineByKey.get(e.key);
        return pristineText !== undefined
          && allowedKeys.has(e.key)
          && isSafeTranslatedText(pristineText, e.text);
      });
    } else {
      translatedEntries = await this.translateViaEngine(translatableEntries, TRANSLATION_SOURCE_LANGUAGE, target, generation, allowedKeys);
      if (!this.isCurrentGeneration(generation)) return;

      await this.cache.write({
        schemaVersion: SCHEMA_VERSION,
        sourceLang: TRANSLATION_SOURCE_LANGUAGE,
        targetLang: target,
        bundleHash,
        entries: translatedEntries,
        lastUsedAt: Date.now(),
      });
      if (!this.isCurrentGeneration(generation)) return;
    }

    // 4. Merge over the pristine bundle and apply ATOMICALLY (ES-04) — a
    // single setTranslation() call with the fully-built bundle; no partial
    // application is ever visible. Excluded keys (AD-3: credential vocabulary,
    // verification verdicts) are never machine-translated and stay in the
    // user's native language, not in the English source.
    const nativeExcluded = flattenUiBundle(nativeBundle).filter(e => isExcludedKey(e.key));
    const merged = mergeUiBundles(
      mergeUiBundles(pristineBundle, inflateUiBundle(translatedEntries)),
      inflateUiBundle(nativeExcluded),
    );
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
    const pair = { sourceLanguage, targetLanguage };
    this._progress.set({ phase: 'downloading', fraction: 0 });
    await this.engine.prepare(pair, (loaded, total) => {
      if (this.isCurrentGeneration(generation)) {
        // The engine may report several packs, each from 0 to 1 — keep the
        // furthest point reached so the bar never goes backwards.
        const ratio = total > 0 ? Math.min(1, loaded / total) : 0;
        const fraction = Math.max(this._progress()?.fraction ?? 0, ratio * DOWNLOAD_PROGRESS_WEIGHT);
        this._progress.set({ phase: 'downloading', fraction });
      }
    });
    if (!this.isCurrentGeneration(generation)) return []; // cancelled while the language pack downloaded
    this._progress.set({ phase: 'applying', fraction: DOWNLOAD_PROGRESS_WEIGHT });

    const maskedEntries = entries.map(e => ({ key: e.key, text: maskPlaceholders(e.text) }));

    const rawTranslated = await this.withStallGuard(onBatchDone => this.engine.translateEntries(
      maskedEntries,
      pair,
      allowedKeys,
      (done, total) => {
        onBatchDone();
        if (this.isCurrentGeneration(generation)) {
          const ratio = total > 0 ? done / total : 0;
          this._progress.set({
            phase: 'applying',
            fraction: DOWNLOAD_PROGRESS_WEIGHT + (1 - DOWNLOAD_PROGRESS_WEIGHT) * ratio,
          });
        }
      },
    ));

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

  private fetchBundle(lang: LanguageTag): Promise<string> {
    return firstValueFrom(
      this.http.get(`assets/i18n/${lang}.json`, { responseType: 'text' }).pipe(
        timeout(BUNDLE_FETCH_TIMEOUT_MS),
      ),
    );
  }

  /** Restores the native UI from the in-memory native bundle — 0 network requests (NFR-S-142-03). */
  private restoreNativeLanguageDisplay(): void {
    const nativeLang = this.currentNativeLang();
    if (this._nativeBundle?.lang === nativeLang) {
      this.translate.setTranslation(nativeLang, this._nativeBundle.bundle, false);
    }
    this.document.documentElement.lang = nativeLang;
    this.document.documentElement.dir = 'ltr';
  }

  /** Candidate targets: every language except the ones the tenant loaded natively (the source language is not a candidate). */
  private candidateLanguages(): ReadonlyArray<LanguageTag> {
    const loaded = this.translate.getLangs();
    const native = new Set<LanguageTag>(loaded.length > 0 ? loaded : DEFAULT_NATIVE_LANGUAGES);
    return RUNTIME_TRANSLATION_CANDIDATE_LANGUAGES.filter(language => !native.has(language));
  }

  private currentNativeLang(): LanguageTag {
    return this.translate.currentLang || this.translate.getDefaultLang();
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this._generation;
  }

  /**
   * Runs `start` and rejects if it goes `TRANSLATION_STALL_TIMEOUT_MS` without
   * calling the `onBatchDone` it is given (ES-05) — the timer restarts on every
   * batch, so only a stalled translation fails, never a slow one. Rejects
   * without cancelling the underlying work; generation guards make any late
   * result a no-op.
   */
  private withStallGuard<T>(start: (onBatchDone: () => void) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const arm = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          const error = new Error('ui-translation: translation stalled for TRANSLATION_STALL_TIMEOUT_MS');
          error.name = 'TranslationStalledError';
          reject(error);
        }, TRANSLATION_STALL_TIMEOUT_MS);
      };
      arm();
      start(arm).then(
        value => { clearTimeout(timer); resolve(value); },
        err => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
