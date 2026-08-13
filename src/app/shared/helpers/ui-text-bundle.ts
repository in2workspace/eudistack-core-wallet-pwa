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
    hash ^= json.charCodeAt(i);
    // hash *= FNV prime (0x01000193), via shifts to stay in 32-bit int arithmetic
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
