import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { Observable, TimeoutError, catchError, distinctUntilChanged, map, of, startWith, switchMap, timeout } from 'rxjs';
import { BUILD_INFO } from 'src/app/core/constants/build-info.constants';
import { LEGAL_DOCUMENT_TIMEOUT_MS } from 'src/app/core/constants/support.constants';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import {
  LEGAL_FALLBACK_LANG,
  LegalContentResult,
  LegalDocumentId,
  LegalLang,
  isLegalLang,
} from '../models/legal-document.model';

/**
 * AC-04 / EC-01 / ES-01 / ES-02 / ES-04 / ES-05.
 * Resolves and fetches a legal document for the active interface language,
 * falling back to LEGAL_FALLBACK_LANG on a single 404, cancelling any
 * in-flight request when the language changes, and timing out at
 * LEGAL_DOCUMENT_TIMEOUT_MS.
 */
@Injectable({ providedIn: 'root' })
export class LegalContentService {
  private readonly http = inject(HttpClient);
  private readonly translate = inject(TranslateService);
  private readonly telemetry = inject(TelemetryService);

  /**
   * Emits once per active language change; the previous in-flight request is
   * cancelled by switchMap (ES-05) — content from two languages is never mixed.
   */
  load(docId: LegalDocumentId): Observable<LegalContentResult> {
    return this.activeLang$().pipe(switchMap((lang) => this.fetchWithFallback(docId, lang)));
  }

  private activeLang$(): Observable<LegalLang> {
    const current = this.translate.currentLang || this.translate.getDefaultLang();
    return this.translate.onLangChange.pipe(
      map((e) => e.lang),
      startWith(current),
      map((lang) => (isLegalLang(lang) ? lang : LEGAL_FALLBACK_LANG)),
      distinctUntilChanged()
    );
  }

  private fetchWithFallback(docId: LegalDocumentId, lang: LegalLang): Observable<LegalContentResult> {
    return this.fetchRaw(docId, lang).pipe(
      map(
        (html): LegalContentResult => ({
          status: 'ready',
          content: { docId, lang, html, isFallbackLanguage: false },
        })
      ),
      catchError((err: unknown) => {
        // EC-01: 404 on the active language ⇒ a SINGLE retry in the fallback language. No third attempt.
        if (lang !== LEGAL_FALLBACK_LANG && err instanceof HttpErrorResponse && err.status === 404) {
          return this.fetchRaw(docId, LEGAL_FALLBACK_LANG).pipe(
            map(
              (html): LegalContentResult => ({
                status: 'ready',
                content: { docId, lang: LEGAL_FALLBACK_LANG, html, isFallbackLanguage: true },
              })
            ),
            catchError((e2: unknown) => of(this.toFailure(docId, lang, e2)))
          );
        }
        return of(this.toFailure(docId, lang, err));
      })
    );
  }

  /**
   * ES-02 — the URL is composed EXCLUSIVELY from the closed catalogue: `docId`
   * and `lang` are validated union types; no string coming from a route param
   * reaches here without going through `legalDocumentGuard` first.
   *
   * Relative path on purpose: the CD deploys with --base-href=/wallet/; an
   * absolute '/assets/...' path would resolve outside that base href.
   */
  private fetchRaw(docId: LegalDocumentId, lang: LegalLang): Observable<string> {
    return this.http
      .get(`assets/legal/${lang}/${docId}.html`, { responseType: 'text' })
      .pipe(timeout(LEGAL_DOCUMENT_TIMEOUT_MS));
  }

  private toFailure(docId: LegalDocumentId, lang: LegalLang, err: unknown): LegalContentResult {
    const reason =
      err instanceof TimeoutError
        ? 'timeout'
        : err instanceof HttpErrorResponse && err.status === 404
          ? 'not-found'
          : 'unavailable';
    // ES-01 — the failure is recorded. Payload has no PII: only docId, lang and build.
    this.telemetry.track('about_legal_document_load_failed', {
      docId,
      lang,
      reason,
      version: BUILD_INFO.version,
      buildId: BUILD_INFO.buildId,
    });
    return { status: 'error', reason };
  }
}
