import { TestBed } from '@angular/core/testing';
import { Router, convertToParamMap } from '@angular/router';
import { legalDocumentGuard } from './legal-document.guard';

describe('legalDocumentGuard (ES-02)', () => {
  let routerMock: { createUrlTree: jest.Mock };

  beforeEach(() => {
    routerMock = { createUrlTree: jest.fn().mockReturnValue('URL_TREE_TO_ABOUT') };
    TestBed.configureTestingModule({ providers: [{ provide: Router, useValue: routerMock }] });
  });

  function runGuard(docId: string | null) {
    const route: any = { paramMap: convertToParamMap(docId ? { docId } : {}) };
    return TestBed.runInInjectionContext(() => legalDocumentGuard(route, {} as any));
  }

  it('allows navigation for each id in the closed catalogue', () => {
    expect(runGuard('terms-of-service')).toBe(true);
    expect(runGuard('privacy-policy')).toBe(true);
    expect(runGuard('legal-notice')).toBe(true);
    expect(routerMock.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects to About via UrlTree (not navigate()) for an id outside the catalogue', () => {
    const result = runGuard('../../etc/passwd');

    expect(result).toBe('URL_TREE_TO_ABOUT');
    expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/tabs/about']);
  });

  it('redirects when the docId param is missing entirely', () => {
    const result = runGuard(null);

    expect(result).toBe('URL_TREE_TO_ABOUT');
    expect(routerMock.createUrlTree).toHaveBeenCalledWith(['/tabs/about']);
  });
});
