import { TestBed, ComponentFixture } from '@angular/core/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { LegalDocumentPage } from './legal-document.page';
import { LegalContentService } from '../services/legal-content.service';
import { LegalContentResult } from '../models/legal-document.model';

async function createFixture(
  legalContentMock: { load: jest.Mock },
  docId = 'privacy-policy'
): Promise<ComponentFixture<LegalDocumentPage>> {
  const paramMap$ = new BehaviorSubject(convertToParamMap({ docId }));

  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [LegalDocumentPage, IonicModule.forRoot(), TranslateModule.forRoot()],
    providers: [
      { provide: LegalContentService, useValue: legalContentMock },
      { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LegalDocumentPage);
  fixture.detectChanges();
  return fixture;
}

describe('LegalDocumentPage', () => {
  it('shows an accessible loading indicator before the content resolves (ES-04)', async () => {
    const legalContentMock = { load: jest.fn().mockReturnValue(new Subject<LegalContentResult>()) };
    const fixture = await createFixture(legalContentMock);

    const loading = fixture.nativeElement.querySelector('[role="status"][aria-live="polite"]');
    expect(loading).toBeTruthy();
    expect(fixture.componentInstance.state()).toBe('loading');
  });

  it('renders the sanitized content once ready, with a back action to About (AC-03/AC-04)', async () => {
    const legalContentMock = {
      load: jest.fn().mockReturnValue(
        of<LegalContentResult>({
          status: 'ready',
          content: { docId: 'privacy-policy', lang: 'es', html: '<p>Contenido legal</p>', isFallbackLanguage: false },
        })
      ),
    };
    const fixture = await createFixture(legalContentMock);

    expect(fixture.componentInstance.state()).toBe('ready');
    expect(fixture.nativeElement.querySelector('.legal-document-content').innerHTML).toContain('Contenido legal');
    expect(fixture.nativeElement.querySelector('ion-back-button')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.legal-document-fallback-notice')).toBeNull();
  });

  it('shows the fallback-language banner when the content was served from LEGAL_FALLBACK_LANG (EC-01)', async () => {
    const legalContentMock = {
      load: jest.fn().mockReturnValue(
        of<LegalContentResult>({
          status: 'ready',
          content: { docId: 'legal-notice', lang: 'es', html: '<p>Contenido</p>', isFallbackLanguage: true },
        })
      ),
    };
    const fixture = await createFixture(legalContentMock);

    expect(fixture.nativeElement.querySelector('.legal-document-fallback-notice')).toBeTruthy();
  });

  it('shows an error state with a retry action that re-invokes the load (ES-01)', async () => {
    const legalContentMock = {
      load: jest
        .fn()
        .mockReturnValueOnce(of<LegalContentResult>({ status: 'error', reason: 'unavailable' }))
        .mockReturnValueOnce(
          of<LegalContentResult>({
            status: 'ready',
            content: { docId: 'privacy-policy', lang: 'es', html: '<p>OK</p>', isFallbackLanguage: false },
          })
        ),
    };
    const fixture = await createFixture(legalContentMock);

    expect(fixture.componentInstance.state()).toBe('error');
    const errorBlock = fixture.nativeElement.querySelector('[role="alert"]');
    expect(errorBlock).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.legal-document-content')).toBeNull();

    const retryBtn: HTMLButtonElement = fixture.nativeElement.querySelector('.legal-document-retry-btn');
    retryBtn.click();
    fixture.detectChanges();

    expect(legalContentMock.load).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.state()).toBe('ready');
  });

  it('neutralizes executable markup while keeping the surrounding legible text (ES-06)', async () => {
    const legalContentMock = {
      load: jest.fn().mockReturnValue(
        of<LegalContentResult>({
          status: 'ready',
          content: {
            docId: 'legal-notice',
            lang: 'es',
            html: '<p>Texto legal legible</p><script>window.__pwned = true;</script><img src="x" onerror="window.__pwned = true"><iframe src="https://evil.example"></iframe>',
            isFallbackLanguage: false,
          },
        })
      ),
    };
    const fixture = await createFixture(legalContentMock);

    const container: HTMLElement = fixture.nativeElement.querySelector('.legal-document-content');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img')?.hasAttribute('onerror')).not.toBe(true);
    expect(container.textContent).toContain('Texto legal legible');
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it('cancels the previous in-flight load when the route docId changes without leaving the page', async () => {
    const first$ = new Subject<LegalContentResult>();
    const legalContentMock = { load: jest.fn().mockReturnValue(first$) };

    const paramMap$ = new BehaviorSubject(convertToParamMap({ docId: 'privacy-policy' }));
    await TestBed.configureTestingModule({
      schemas: [NO_ERRORS_SCHEMA],
      imports: [LegalDocumentPage, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: LegalContentService, useValue: legalContentMock },
        { provide: ActivatedRoute, useValue: { paramMap: paramMap$ } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(LegalDocumentPage);
    fixture.detectChanges();

    const second$ = new Subject<LegalContentResult>();
    legalContentMock.load.mockReturnValue(second$);
    paramMap$.next(convertToParamMap({ docId: 'legal-notice' }));

    expect(first$.observed).toBe(false); // unsubscribed when docId changed

    second$.next({
      status: 'ready',
      content: { docId: 'legal-notice', lang: 'es', html: '<p>Nuevo</p>', isFallbackLanguage: false },
    });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.legal-document-content').innerHTML).toContain('Nuevo');
  });
});
