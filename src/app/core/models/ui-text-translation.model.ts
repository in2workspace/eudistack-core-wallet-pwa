/**
 * Domain models for runtime UI translation (EUD-142).
 *
 * These types are pure domain — no framework imports. They model the layer that
 * lets a Holder translate *static interface text* into a language not natively
 * supported (es/en/ca, US-02/EUD-131), using the browser's on-device translation
 * engine (AD-1). Nothing in this file, nor anything typed with it, may originate
 * from credential content or personal data (FR-25 / NFR-Pr-03) — see `UiTextKey`.
 */

/**
 * A BCP 47 language tag (e.g. `'el'`, `'ar'`, `'es'`). Documented alias, not a
 * validated type: validity is enforced at the boundary (candidate language list,
 * `Translator.availability()`), not by the type system. Sonar flags aliases of
 * primitive types as redundant (typescript:S6564) — kept deliberately: it is
 * self-documenting at every one of its dozens of call sites across this
 * layer, and making it a genuinely validated branded type (like `UiTextKey`)
 * would be overkill for a value that is never trusted without a runtime
 * check anyway. NOSONAR: intentional, not an oversight.
 */
export type LanguageTag = string; // NOSONAR

/**
 * Nominal (branded) type for i18n keys that are safe to hand to the translation
 * engine. The only producer of `UiTextKey` is `flattenUiBundle()`
 * (`ui-text-bundle.ts`, task 8): a value can only carry this brand by having gone
 * through the release i18n bundle. This makes it a compile-time error to pass
 * arbitrary text (e.g. credential content) to `TranslationEnginePort` — the
 * structural half of the FR-25/NFR-Pr-03 privacy boundary (AC-04).
 */
export type UiTextKey = string & { readonly __uiTextKey: unique symbol };

/** A single flattened i18n leaf: a `UiTextKey` paired with its text value. */
export interface UiTextEntry {
  readonly key: UiTextKey;
  readonly text: string;
}

/**
 * Result of probing the on-device engine for a given source/target language pair
 * (`Translator.availability()`). Exact vocabulary of the Translator API (Chrome
 * for Developers, consulted 2026-08-04) — see `technical-design.md` §3.3.
 *
 * - `'unavailable'`  — the pair cannot be translated on this device.
 * - `'downloadable'` — supported, but the language pack must be fetched first.
 * - `'available'`    — supported and ready to use immediately.
 */
export type TranslationAvailability = 'unavailable' | 'downloadable' | 'available';

/**
 * State machine of `UiTextTranslationService` (EC-07). Mirrors the orchestrator's
 * `status` signal.
 *
 * - `'idle'`        — feature not engaged; native language shown as-is.
 * - `'probing'`     — checking engine availability for a candidate pair.
 * - `'preparing'`    — engine activation in flight (fetch bundle / cache / engine call).
 * - `'active'`      — translated UI is currently applied.
 * - `'unavailable'` — no on-device engine exposed by this browser/platform (EC-01).
 * - `'error'`       — the last activation attempt failed (ES-02/ES-04/ES-05).
 */
export type UiTranslationStatus = 'idle' | 'probing' | 'preparing' | 'active' | 'unavailable' | 'error';

/**
 * User's runtime translation preference. Persisted as part of `UserPreferences`
 * (`user-preferences.service.ts`, task 13). Additive over the native language
 * (AC-07) — never replaces it.
 */
export interface RuntimeTranslationPreference {
  readonly enabled: boolean;
  readonly targetLanguage: LanguageTag | null;
}

/** Current schema version of `CachedUiTranslation` records. Bump on shape changes. */
export const SCHEMA_VERSION = 1;

/**
 * A validated, persisted translation result for one (source, target, bundle)
 * triple. Read/written by `UiTranslationCacheService` (task 12). Contains only
 * UI chrome text — never credential content or personal data (AC-13).
 */
export interface CachedUiTranslation {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly sourceLang: LanguageTag;
  readonly targetLang: LanguageTag;
  /** FNV-1a (32-bit) hash of the source bundle JSON — detects release drift (EC-05). */
  readonly bundleHash: string;
  readonly entries: readonly UiTextEntry[];
  /** `Date.now()` timestamp of last use — drives LRU eviction (NFR-S-142-05). */
  readonly lastUsedAt: number;
}
