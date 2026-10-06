import { HttpErrorResponse } from '@angular/common/http';
import { defaultHttpToTranslationKey, isCredentialRevokedResponse } from './http-error-message';

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

  describe('isCredentialRevokedResponse', () => {
    const body = '{"type":"credential_revoked","title":"Verifiable presentation failed","status":403,"detail":"The credential has been revoked"}';

    it('detects a 403 revoked body received as text', () => {
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 403, error: body }))).toBe(true);
    });

    it('detects a 403 revoked body received as an object', () => {
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 403, error: JSON.parse(body) }))).toBe(true);
    });

    it('ignores a 403 that only mentions revocation in its detail', () => {
      const other = '{"type":"wallet_attestation_revoked","detail":"The credential has been revoked"}';
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 403, error: other }))).toBe(false);
    });

    it('ignores a non-JSON 403 body', () => {
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 403, error: 'credential_revoked' }))).toBe(false);
    });

    it('ignores other 403 errors', () => {
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 403, error: '{"type":"issuer_not_trusted"}' }))).toBe(false);
    });

    it('ignores revoked text on non-403 statuses and non-HTTP errors', () => {
      expect(isCredentialRevokedResponse(new HttpErrorResponse({ status: 500, error: body }))).toBe(false);
      expect(isCredentialRevokedResponse(new Error('boom'))).toBe(false);
    });
  });
});
