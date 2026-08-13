/**
 * Configuration constants for runtime UI translation (EUD-142).
 *
 * Values referenced by `UiTextTranslationService` (task 15),
 * `BrowserTranslatorEngineAdapter` (task 11) and `UiTranslationCacheService`
 * (task 12). Kept in one file so every numeric/behavioral threshold from
 * `technical-design.md` §3.2 and the NFR table (`acceptance-criteria.md` §4)
 * has a single, greppable source.
 */

import { LanguageTag } from '../models/ui-text-translation.model';

/**
 * Candidate target languages for runtime translation — BCP 47, deliberately
 * excludes the natively-supported languages (`en`, `es`, `ca`, US-02/EUD-131):
 * this feature is an additional layer over the native language, never a
 * replacement (AC-07). There is no engine API to enumerate supported
 * languages (EC-02) — each pair is probed individually against this list.
 */
export const RUNTIME_TRANSLATION_CANDIDATE_LANGUAGES: readonly LanguageTag[] = [
  'ar', 'bg', 'bn', 'cs', 'da', 'de', 'el', 'fa', 'fi', 'fil', 'fr', 'he', 'hi',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nl', 'no', 'pl', 'pt',
  'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'th', 'tr', 'uk', 'ur', 'vi', 'zh',
];

/** Right-to-left BCP 47 language tags (AD-5) — drives `documentElement.dir`. */
export const RTL_LANGUAGE_TAGS: readonly LanguageTag[] = ['ar', 'he', 'fa', 'ur'];

/**
 * Deny-list of i18n key prefixes never eligible for runtime translation
 * (AD-3, frontier by data provenance). Scoped to the specific sub-namespaces
 * that are genuinely credential-claim vocabulary — not the whole `vc-fields.`
 * or `verification.` namespace, which also hosts pure app chrome (the detail
 * modal title, the delete/verify buttons, result banners, check labels) that
 * AD-3 itself says must translate. A blanket prefix on either namespace was
 * over-broad: field LABELS and claim-derived vocabulary stay native (risk of
 * misrepresenting what the credential asserts, per AD-3's own rationale);
 * everything else in those namespaces is ordinary UI text.
 */
export const RUNTIME_TRANSLATION_EXCLUDED_KEY_PREFIXES: readonly string[] = [
  'vc-fields.credentialInfo.',
  'vc-fields.credentialEncoded',
  'vc-fields.learCredentialEmployee.',
  'vc-fields.lear-credential-machine.',
  'vc-fields.gaia-x-label-credential.',
  'vc-fields.power.',
];

/** `StorageService` key prefix for cached translations (`UiTranslationCacheService`). */
export const UI_TRANSLATION_CACHE_KEY_PREFIX = 'ui-translation-cache:';

/** Max simultaneously cached target languages — LRU eviction beyond this (NFR-S-142-05). */
export const MAX_CACHED_TRANSLATIONS = 3;

/** Max cached bytes per language — approximate, measured on the serialized entry (NFR-S-142-05). */
export const MAX_CACHED_BYTES_PER_LANGUAGE = 200_000;

/** Hard timeout for a full activation (probe → engine → apply) — ES-05, NFR-S-142-02. */
export const TRANSLATION_BUDGET_MS = 20_000;

/** Timeout fetching the pristine i18n bundle (`assets/i18n/<lang>.json`) — ES-02. */
export const BUNDLE_FETCH_TIMEOUT_MS = 3_000;

/**
 * Entries translated per engine batch. The release bundle has ~500 leaf keys
 * (`src/assets/i18n/es.json`); chunking keeps each batch's main-thread work
 * well under the ≤ 50 ms/batch ceiling of NFR-S-142-02 while still allowing
 * `onProgress` to report meaningfully often during the first (uncached)
 * activation (AC-11).
 */
export const TRANSLATION_CHUNK_SIZE = 25;
