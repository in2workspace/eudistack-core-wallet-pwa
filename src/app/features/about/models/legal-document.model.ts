// DOMAIN — no imports from @angular/*, rxjs, @ionic/* or @ngx-translate/*.

/** Closed catalogue. The only source of navigable legal document ids (ES-02). */
export const LEGAL_DOCUMENT_IDS = [
  'terms-of-service',
  'privacy-policy',
  'legal-notice',
] as const;

export type LegalDocumentId = (typeof LEGAL_DOCUMENT_IDS)[number];

/** Languages with packaged legal content. `es` is the fallback (EC-01). */
export const LEGAL_LANGS = ['es', 'en', 'ca'] as const;
export type LegalLang = (typeof LEGAL_LANGS)[number];
export const LEGAL_FALLBACK_LANG: LegalLang = 'es';

export function isLegalDocumentId(value: string | null | undefined): value is LegalDocumentId {
  return value != null && (LEGAL_DOCUMENT_IDS as readonly string[]).includes(value);
}

export function isLegalLang(value: string | null | undefined): value is LegalLang {
  return value != null && (LEGAL_LANGS as readonly string[]).includes(value);
}

export interface LegalDocumentContent {
  readonly docId: LegalDocumentId;
  /** Language actually served — may differ from the requested one (EC-01). */
  readonly lang: LegalLang;
  readonly html: string;
  /** true when LEGAL_FALLBACK_LANG was served because the requested language was missing (EC-01). */
  readonly isFallbackLanguage: boolean;
}

export type LegalContentFailureReason = 'not-found' | 'timeout' | 'unavailable';

export interface LegalContentFailure {
  readonly reason: LegalContentFailureReason;
}

/** Result type: the UI layer switches exhaustively instead of try/catch. */
export type LegalContentResult =
  | { readonly status: 'ready'; readonly content: LegalDocumentContent }
  | ({ readonly status: 'error' } & LegalContentFailure);
