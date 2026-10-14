import { HttpErrorResponse } from '@angular/common/http';
import { defaultHttpToTranslationKey, isCredentialRevokedResponse, mapApiError, wrapOid4vciHttpError, wrapOid4vpHttpError } from './http-error-message';
import { CredentialAlreadyIssuedError, CredentialOfferExpiredError, CredentialOfferNotFoundError, Oid4vciError } from '../../core/models/error/Oid4vciError';
import { Oid4vpError } from '../../core/models/error/Oid4vpError';

const EXPIRED_PROBLEM = {
  type: 'credential_offer_expired',
  title: 'Credential offer expired',
  status: 410,
  detail: 'The credential offer has expired.',
  instance: 'aa7ead92-35f7-4c24-af44-678d35dd38c0',
};

function expired410(body: unknown = EXPIRED_PROBLEM): HttpErrorResponse {
  return new HttpErrorResponse({ status: 410, statusText: 'Gone', error: body });
}

function captureThrown(fn: () => void): unknown {
  try {
    fn();
  } catch (e: unknown) {
    return e;
  }
  throw new Error('expected function to throw');
}

describe('http-error-message helper', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('mapApiError', () => {
    it('maps credential_offer_expired to CredentialOfferExpiredError', () => {
      expect(mapApiError(EXPIRED_PROBLEM)).toBeInstanceOf(CredentialOfferExpiredError);
    });

    it('gives the expired error its dedicated translation key', () => {
      expect(mapApiError(EXPIRED_PROBLEM)?.translationKey).toBe('errors.credential-offer-expired');
    });

    it('keeps the original error as cause', () => {
      const cause = expired410();
      expect(mapApiError(EXPIRED_PROBLEM, cause)?.cause).toBe(cause);
    });

    it('maps credential_offer_not_found to CredentialOfferNotFoundError', () => {
      expect(mapApiError({ type: 'credential_offer_not_found', status: 404 })).toBeInstanceOf(CredentialOfferNotFoundError);
    });

    it('gives the not-found error its dedicated translation key', () => {
      expect(mapApiError({ type: 'credential_offer_not_found' })?.translationKey).toBe('errors.credential-offer-not-found');
    });

    it('maps credential_already_issued to CredentialAlreadyIssuedError', () => {
      expect(mapApiError({ type: 'credential_already_issued', status: 410 })).toBeInstanceOf(CredentialAlreadyIssuedError);
    });

    it('gives the already-issued error its dedicated translation key', () => {
      expect(mapApiError({ type: 'credential_already_issued' })?.translationKey).toBe('errors.credential-already-issued');
    });

    it('returns null for an unknown type so callers fall back to the status', () => {
      expect(mapApiError({ type: 'credential_offer_gone', status: 410 })).toBeNull();
    });

    it('returns null for a malformed (unparsed) payload', () => {
      expect(mapApiError(null)).toBeNull();
    });
  });

  describe('defaultHttpToTranslationKey', () => {
    it('maps 410 + credential_offer_expired to errors.credential-offer-expired', () => {
      expect(defaultHttpToTranslationKey(expired410())).toBe('errors.credential-offer-expired');
    });

    it('maps 410 + credential_offer_expired sent as raw text to errors.credential-offer-expired', () => {
      expect(defaultHttpToTranslationKey(expired410(JSON.stringify(EXPIRED_PROBLEM)))).toBe('errors.credential-offer-expired');
    });

    it.each([410, 409])('maps %s + credential_already_issued to errors.credential-already-issued', (status) => {
      const error = new HttpErrorResponse({ status, error: { type: 'credential_already_issued' } });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.credential-already-issued');
    });

    it('should map 410 without a known type to errors.credential-offer-already-processed', () => {
      const error = new HttpErrorResponse({ status: 410 });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.credential-offer-already-processed');
    });

    it('maps 410 with a non-JSON body to errors.credential-offer-already-processed', () => {
      expect(defaultHttpToTranslationKey(expired410('Gone'))).toBe('errors.credential-offer-already-processed');
    });

    it('should map network errors (status 0) to errors.network-error', () => {
      const error = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.network-error');
    });

    it('should map 400 to errors.invalid-request', () => {
      expect(defaultHttpToTranslationKey(new HttpErrorResponse({ status: 400 }))).toBe('errors.invalid-request');
    });

    it.each([401, 403])('should map %s to errors.not-authorized', (status) => {
      expect(defaultHttpToTranslationKey(new HttpErrorResponse({ status }))).toBe('errors.not-authorized');
    });

    it('maps 404 + credential_offer_not_found to errors.credential-offer-not-found', () => {
      const error = new HttpErrorResponse({ status: 404, error: { type: 'credential_offer_not_found' } });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.credential-offer-not-found');
    });

    it('should map 404 to errors.resource-not-found', () => {
      const error = new HttpErrorResponse({ status: 404 });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.resource-not-found');
    });

    it.each([500, 502, 504])('should map %s to errors.server-error', (status) => {
      const error = new HttpErrorResponse({ status });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.server-error');
    });

    it('should map other errors to errors.default', () => {
      const error = new HttpErrorResponse({ status: 418 });
      expect(defaultHttpToTranslationKey(error)).toBe('errors.default');
    });
  });

  describe('wrapOid4vciHttpError', () => {
    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

    it('throws CredentialOfferExpiredError for 410 + credential_offer_expired', () => {
      const thrown = captureThrown(() => wrapOid4vciHttpError(expired410(), 'Could not download the credential offer'));

      expect(thrown).toBeInstanceOf(CredentialOfferExpiredError);
    });

    it('lets the expired type win over the caller-provided translationKey', () => {
      const thrown = captureThrown(() =>
        wrapOid4vciHttpError(expired410(), 'Could not download the credential offer', {
          translationKey: 'errors.cannot-download-credentialOffer',
        })
      ) as Oid4vciError;

      expect(thrown.translationKey).toBe('errors.credential-offer-expired');
    });

    it('logs status, type and instance for traceability', () => {
      captureThrown(() => wrapOid4vciHttpError(expired410(), 'Could not download the credential offer'));

      expect(console.error).toHaveBeenCalledWith(
        'Could not download the credential offer: Credential offer expired',
        { status: 410, type: 'credential_offer_expired', instance: 'aa7ead92-35f7-4c24-af44-678d35dd38c0' }
      );
    });

    it('keeps the caller translationKey when the body has no known type', () => {
      const thrown = captureThrown(() =>
        wrapOid4vciHttpError(new HttpErrorResponse({ status: 500 }), 'Could not download the credential offer', {
          translationKey: 'errors.cannot-download-credentialOffer',
        })
      ) as Oid4vciError;

      expect(thrown.translationKey).toBe('errors.cannot-download-credentialOffer');
    });

    it('falls back to the status-based key without a caller translationKey', () => {
      const thrown = captureThrown(() =>
        wrapOid4vciHttpError(new HttpErrorResponse({ status: 503 }), 'Could not download')
      ) as Oid4vciError;

      expect(thrown.message).toBe('Could not download (HTTP 503)');
      expect(thrown.translationKey).toBe('errors.server-error');
    });

    it('rethrows an existing Oid4vciError untouched', () => {
      const original = new Oid4vciError('already wrapped');
      expect(captureThrown(() => wrapOid4vciHttpError(original, 'x'))).toBe(original);
    });

    it('wraps non-HTTP errors (e.g. timeouts) with errors.default', () => {
      const thrown = captureThrown(() => wrapOid4vciHttpError(new Error('Timeout has occurred'), 'x')) as Oid4vciError;

      expect(thrown).toBeInstanceOf(Oid4vciError);
      expect(thrown.translationKey).toBe('errors.default');
    });
  });

  describe('wrapOid4vpHttpError', () => {
    it('keeps status-based mapping for HTTP errors', () => {
      const thrown = captureThrown(() => wrapOid4vpHttpError(new HttpErrorResponse({ status: 404 }), 'x')) as Oid4vpError;

      expect(thrown.translationKey).toBe('errors.resource-not-found');
    });
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
