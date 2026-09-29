import { HttpErrorResponse } from '@angular/common/http';
import { defaultHttpToTranslationKey } from './http-error-message';

describe('http-error-message helper', () => {
  it('should map 410 to errors.credential-offer-already-processed', () => {
    const error = new HttpErrorResponse({ status: 410 });
    expect(defaultHttpToTranslationKey(error)).toBe('errors.credential-offer-already-processed');
  });

  it('should map 404 to errors.resource-not-found', () => {
    const error = new HttpErrorResponse({ status: 404 });
    expect(defaultHttpToTranslationKey(error)).toBe('errors.resource-not-found');
  });

  it('should map 500 to errors.server-error', () => {
    const error = new HttpErrorResponse({ status: 500 });
    expect(defaultHttpToTranslationKey(error)).toBe('errors.server-error');
  });

  it('should map other errors to errors.default', () => {
    const error = new HttpErrorResponse({ status: 418 });
    expect(defaultHttpToTranslationKey(error)).toBe('errors.default');
  });
});
