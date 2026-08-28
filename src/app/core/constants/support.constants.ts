// DOMAIN — no imports from @angular/*, rxjs, @ionic/* or @ngx-translate/*.

/**
 * PLACEHOLDER pending confirmation by the PO before production
 * (functional-analysis.md §Puntos a validar, 2026-08-04; risk R-8 in technical-design.md).
 * Single point of change: do not duplicate this literal in any other file.
 */
export const SUPPORT_EMAIL = 'support@eudistack.com';

/** Public issue tracker of the wallet-pwa repo itself (PO decision, 2026-08-04). */
export const ISSUE_TRACKER_URL =
  'https://github.com/in2workspace/eudistack-core-wallet-pwa/issues/new';

/** Timeout for loading a legal document (ES-04, NFR-S-135-03). */
export const LEGAL_DOCUMENT_TIMEOUT_MS = 5_000;

export interface SupportChannels {
  readonly email: string;
  /** null ⇒ the help-center item is NOT rendered (EC-02). */
  readonly helpCenterUrl: string | null;
  readonly issueTrackerUrl: string;
}

/**
 * Fail-closed schema validation for tenant-provided support channel overrides
 * (STRIDE Spoofing mitigation, AD-4/EC-07): an invalid value is discarded in
 * favor of the default constant, never trusted as-is.
 */
export function isEmailAddress(value: string | null | undefined): value is string {
  return !!value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isHttpsUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
