import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { EventEmitter } from '@angular/core';
import { LangChangeEvent, TranslateService } from '@ngx-translate/core';
import { LegalContentService } from './legal-content.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { LegalContentResult } from '../models/legal-document.model';

describe('LegalContentService', () => {
  let service: LegalContentService;
  let httpMock: HttpTestingController;
  let translateServiceMock: {
    currentLang: string;
    onLangChange: EventEmitter<LangChangeEvent>;
    getDefaultLang: jest.Mock;
  };
  let telemetryMock: { track: jest.Mock };

  beforeEach(() => {
    translateServiceMock = {
      currentLang: 'es',
      onLangChange: new EventEmitter<LangChangeEvent>(),
      getDefaultLang: jest.fn().mockReturnValue('es'),
    };
    telemetryMock = { track: jest.fn() };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: TelemetryService, useValue: telemetryMock },
      ],
    });

    service = TestBed.inject(LegalContentService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('fetches the document from the active language path (AC-04)', () => {
    translateServiceMock.currentLang = 'en';
    let result: LegalContentResult | undefined;

    service.load('privacy-policy').subscribe((r) => (result = r));

    const req = httpMock.expectOne('assets/legal/en/privacy-policy.html');
    expect(req.request.method).toBe('GET');
    req.flush('<p>English content</p>');

    expect(result).toEqual({
      status: 'ready',
      content: { docId: 'privacy-policy', lang: 'en', html: '<p>English content</p>', isFallbackLanguage: false },
    });
  });

  it('falls back to es on a 404 in the active language, marking isFallbackLanguage (EC-01)', () => {
    translateServiceMock.currentLang = 'ca';
    let result: LegalContentResult | undefined;

    service.load('legal-notice').subscribe((r) => (result = r));

    httpMock.expectOne('assets/legal/ca/legal-notice.html').flush(null, { status: 404, statusText: 'Not Found' });
    const fallbackReq = httpMock.expectOne('assets/legal/es/legal-notice.html');
    fallbackReq.flush('<p>Contenido en español</p>');

    expect(result).toEqual({
      status: 'ready',
      content: {
        docId: 'legal-notice',
        lang: 'es',
        html: '<p>Contenido en español</p>',
        isFallbackLanguage: true,
      },
    });
  });

  it('does not attempt a third request when the es fallback also 404s (EC-01, no cascade)', () => {
    translateServiceMock.currentLang = 'ca';
    let result: LegalContentResult | undefined;

    service.load('legal-notice').subscribe((r) => (result = r));

    httpMock.expectOne('assets/legal/ca/legal-notice.html').flush(null, { status: 404, statusText: 'Not Found' });
    httpMock.expectOne('assets/legal/es/legal-notice.html').flush(null, { status: 404, statusText: 'Not Found' });
    httpMock.verify();

    expect(result).toEqual({ status: 'error', reason: 'not-found' });
  });

  it('reports a non-404 failure as an error and records it via TelemetryService without PII (ES-01)', () => {
    let result: LegalContentResult | undefined;

    service.load('terms-of-service').subscribe((r) => (result = r));

    httpMock.expectOne('assets/legal/es/terms-of-service.html').flush(null, { status: 500, statusText: 'Server Error' });

    expect(result).toEqual({ status: 'error', reason: 'unavailable' });
    expect(telemetryMock.track).toHaveBeenCalledWith(
      'about_legal_document_load_failed',
      expect.objectContaining({ docId: 'terms-of-service', lang: 'es', reason: 'unavailable' })
    );
  });

  it('cancels the wait and reports a timeout after 5s of no response (ES-04)', fakeAsync(() => {
    let result: LegalContentResult | undefined;

    service.load('privacy-policy').subscribe((r) => (result = r));
    httpMock.expectOne('assets/legal/es/privacy-policy.html');

    tick(5001);

    expect(result).toEqual({ status: 'error', reason: 'timeout' });
  }));

  it('cancels the in-flight request when the language changes, never mixing content (ES-05)', () => {
    const results: LegalContentResult[] = [];
    service.load('privacy-policy').subscribe((r) => results.push(r));

    const esReq = httpMock.expectOne('assets/legal/es/privacy-policy.html');

    translateServiceMock.onLangChange.emit({ lang: 'en', translations: {} } as LangChangeEvent);
    const enReq = httpMock.expectOne('assets/legal/en/privacy-policy.html');

    // The 'es' request resolves AFTER the 'en' one — switchMap must still discard it.
    enReq.flush('<p>English</p>');
    expect(esReq.cancelled).toBe(true);

    expect(results).toEqual([
      { status: 'ready', content: { docId: 'privacy-policy', lang: 'en', html: '<p>English</p>', isFallbackLanguage: false } },
    ]);
  });
});
