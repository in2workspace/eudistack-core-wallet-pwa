/**
 * Pure, Angular-free helpers for runtime UI translation (EUD-142).
 *
 * `flattenUiBundle()` is the **sole producer** of `UiTextKey` (nominal-branded
 * type) — control 1/4 of the FR-25/NFR-Pr-03 privacy boundary
 * (`technical-design.md` §3.4.1): a value can only carry that brand by having
 * gone through this function, i.e. by originating in the release i18n
 * bundle. No other code in this Story constructs a `UiTextKey`.
 */

import { RUNTIME_TRANSLATION_EXCLUDED_KEY_PREFIXES } from '../../core/constants/ui-translation.constants';
import { UiTextEntry, UiTextKey } from '../../core/models/ui-text-translation.model';

/** Nested JSON shape of `src/assets/i18n/<lang>.json` — string leaves, object branches. */
export type UiTextBundle = { [key: string]: string | UiTextBundle };

/**
 * Flattens a nested i18n bundle into a list of dotted-path entries
 * (`{ key: 'credentials.nocred-title', text: '...' }`). The only function in
 * the codebase allowed to produce a `UiTextKey` — every other helper that
 * accepts one only ever receives values that passed through here first.
 *
 * Non-string, non-object leaves (numbers, arrays, `null`) are skipped: the
 * i18n bundles only ever contain string leaves in practice, but this keeps
 * the function total rather than throwing on a malformed asset.
 */
export function flattenUiBundle(bundle: UiTextBundle, prefix = ''): UiTextEntry[] {
  const entries: UiTextEntry[] = [];
  for (const [key, value] of Object.entries(bundle)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      entries.push({ key: path as UiTextKey, text: value });
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenUiBundle(value, path));
    }
    // else: skip (number, array, null — the i18n bundles only ever contain
    // string leaves and object branches in practice)
  }
  return entries;
}

/** Rebuilds a nested bundle from a flat entry list — the inverse of `flattenUiBundle`. */
export function inflateUiBundle(entries: ReadonlyArray<UiTextEntry>): UiTextBundle {
  const bundle: UiTextBundle = {};
  for (const { key, text } of entries) {
    const segments = (key as string).split('.');
    let node = bundle;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const existing = node[segment];
      if (existing === undefined || typeof existing === 'string') {
        node[segment] = {};
      }
      node = node[segment] as UiTextBundle;
    }
    node[segments[segments.length - 1]] = text;
  }
  return bundle;
}

/**
 * Deep-merges `translatedSubset` over `pristine`: any key present in
 * `translatedSubset` overrides the pristine value; any key absent keeps its
 * pristine value (EC-06 — no key is ever dropped). `translatedSubset` is
 * expected to be a partial bundle (excluded/untranslatable keys never
 * appear in it).
 */
export function mergeUiBundles(pristine: UiTextBundle, translatedSubset: UiTextBundle): UiTextBundle {
  const merged: UiTextBundle = { ...pristine };
  for (const [key, translatedValue] of Object.entries(translatedSubset)) {
    const pristineValue = pristine[key];
    if (
      typeof translatedValue === 'object' && translatedValue !== null &&
      typeof pristineValue === 'object' && pristineValue !== null
    ) {
      merged[key] = mergeUiBundles(pristineValue, translatedValue);
    } else {
      merged[key] = translatedValue;
    }
  }
  return merged;
}

/**
 * `true` when `key` falls under `RUNTIME_TRANSLATION_EXCLUDED_KEY_PREFIXES`
 * (AD-3 — frontier by data provenance). Excluded keys are credential /
 * verification-request content and are never sent to the translation
 * engine, regardless of the caller.
 */
export function isExcludedKey(key: UiTextKey | string): boolean {
  return RUNTIME_TRANSLATION_EXCLUDED_KEY_PREFIXES.some(prefix => (key as string).startsWith(prefix));
}

/**
 * FNV-1a (32-bit) hash of `json`, as an 8-char lowercase hex string.
 *
 * Non-cryptographic by design — this is a change-detection fingerprint
 * (EC-05: a release with different text produces a different hash → cache
 * miss), not a security control. Deliberately independent of any per-Story
 * build metadata (e.g. EUD-135's `BUILD_INFO`) to avoid a cross-Story
 * dependency.
 */
export function hashUiBundle(json: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < json.length; i++) {
    hash ^= json.codePointAt(i) ?? 0;
    // hash *= FNV prime (0x01000193), via shifts to stay in 32-bit int arithmetic.
    // The `| 0` is NOT a decimal-truncation idiom (Sonar S3854 flags it as one,
    // suggesting Math.trunc) — it's ToInt32 wraparound, load-bearing for the
    // additions/shifts above staying within 32-bit signed range every
    // iteration. Math.trunc() would NOT wrap an out-of-32-bit-range value and
    // would silently break this hash's determinism. NOSONAR: false positive.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) | 0; // NOSONAR
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Matches `@ngx-translate/core` interpolation params, e.g. `{{ name }}`. */
const PLACEHOLDER_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Rare, paired Unicode brackets (U+2983/U+2984 — mathematical white curly
 * bracket) wrapping the bare param name. Chosen because they are visually
 * and structurally distinct from `{{ }}` — an MT engine has no interpolation
 * syntax to "recognise and mistranslate" — while still round-tripping intact
 * as ordinary characters if the engine passes unrecognised text through
 * unchanged (ES-06).
 */
const SENTINEL_OPEN = '⦃';
const SENTINEL_CLOSE = '⦄';
const SENTINEL_RE = new RegExp(String.raw`${SENTINEL_OPEN}([\w.]+)${SENTINEL_CLOSE}`, 'g');

/**
 * Replaces every `{{ param }}` interpolation marker in `text` with a sentinel
 * that encodes the bare param name. The translation engine only ever
 * receives the sentinel form — the interpolation *value* is substituted by
 * `@ngx-translate/core` in the app, in local, never by the engine (AC-14).
 */
export function maskPlaceholders(text: string): string {
  return text.replace(PLACEHOLDER_RE, (_match, param: string) => `${SENTINEL_OPEN}${param}${SENTINEL_CLOSE}`);
}

/** Restores `{{ param }}` interpolation markers from their sentinel form — the inverse of `maskPlaceholders`. */
export function unmaskPlaceholders(text: string): string {
  return text.replace(SENTINEL_RE, (_match, param: string) => `{{${param}}}`);
}

/**
 * `true` when `candidateText` is a plausible translation of `pristineText` —
 * no HTML-significant characters and a bounded length. Defence-in-depth
 * against a tampered cache record (security-auditor full-mode review,
 * EUD-142 F2): `isCachedUiTranslation` only validates shape and `allowedKeys`
 * only validates that a key belongs to the current pristine bundle — neither
 * constrains the associated TEXT, which otherwise flows unescaped into UI
 * chrome (including `alertController` `message` sinks). Genuine MT output
 * for this bundle is short, plain, unstyled prose: it never needs `<`/`>`
 * and does not balloon to many times the source length.
 */
export function isSafeTranslatedText(pristineText: string, candidateText: string): boolean {
  if (/[<>]/.test(candidateText)) {
    return false;
  }
  const maxLength = Math.max(pristineText.length * 4, 200);
  return candidateText.length > 0 && candidateText.length <= maxLength;
}

/**
 * `true` when `translated` (already unmasked) contains exactly the same
 * multiset of interpolation params as `source` (the pristine text) — same
 * params, same count each, order-independent (translation may reorder
 * words). A mismatch means the engine altered or dropped a marker; the
 * caller falls back to the native text for that key (ES-06, NFR-S-142-06).
 */
export function hasIntactPlaceholders(source: string, translated: string): boolean {
  const extractParams = (text: string): string[] => {
    const params: string[] = [];
    for (const match of text.matchAll(PLACEHOLDER_RE)) {
      params.push(match[1]);
    }
    return params.sort((a, b) => a.localeCompare(b));
  };

  const sourceParams = extractParams(source);
  const translatedParams = extractParams(translated);
  return (
    sourceParams.length === translatedParams.length &&
    sourceParams.every((param, i) => param === translatedParams[i])
  );
}
