import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CredentialOfferService } from './credential-offer.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { HttpErrorResponse } from '@angular/common/http';
import { CredentialOfferExpiredError, CredentialOfferNotFoundError, Oid4vciError } from '../../models/error/Oid4vciError';

const VALID_OFFER_JSON = JSON.stringify({
  credential_issuer: 'https://sandbox.eudistack.net/issuer',
  credential_configuration_ids: ['EmployeeCredential'],
  grants: {
    'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
      'pre-authorized_code': 'abc123',
      user_pin_required: false,
    },
  },
});

describe('CredentialOfferService', () => {
  let service: CredentialOfferService;
  let walletServiceMock: jest.Mocked<Pick<WalletService, 'fetchTextFromUrl'>>;

  beforeEach(() => {
    walletServiceMock = {
      fetchTextFromUrl: jest.fn().mockReturnValue(of(VALID_OFFER_JSON)),
    };

    TestBed.configureTestingModule({
      providers: [
        CredentialOfferService,
        { provide: WalletService, useValue: walletServiceMock },
      ],
    });

    service = TestBed.inject(CredentialOfferService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts a credential offer from the same tenant', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('accepts a credential offer from a different tenant (cross-tenant interoperability)', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://kpmg.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('accepts a credential offer from an external issuer domain', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://issuer.dome-marketplace.eu/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('accepts an offer from an internal hostname (no dots)', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'http://issuer-service:8080/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('does not throw for a malformed offer URI', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri('::not-a-url');

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('throws Oid4vciError when the fetched offer is malformed JSON', async () => {
    walletServiceMock.fetchTextFromUrl.mockReturnValue(of('not-json'));

    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
      ),
    ).rejects.toMatchObject({ translationKey: 'errors.invalid-credentialOffer' });
  });

  it('throws Oid4vciError when credential_configuration_ids is missing', async () => {
    walletServiceMock.fetchTextFromUrl.mockReturnValue(
      of(JSON.stringify({
        credential_issuer: 'https://sandbox.eudistack.net/issuer',
        grants: { 'urn:ietf:params:oauth:grant-type:pre-authorized_code': { 'pre-authorized_code': 'x' } },
      })),
    );

    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
      ),
    ).rejects.toMatchObject({ translationKey: 'errors.invalid-credentialOffer' });
  });

  it('throws Oid4vciError when the fetch itself fails', async () => {
    walletServiceMock.fetchTextFromUrl.mockReturnValue(
      throwError(() => new Oid4vciError('network error', { translationKey: 'errors.cannot-download-credentialOffer' })),
    );

    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
      ),
    ).rejects.toMatchObject({ translationKey: 'errors.cannot-download-credentialOffer' });
  });

  describe('HTTP errors from the offer endpoint', () => {
    const OFFER_URI = 'https://sandbox.eudistack.net/issuer/oid4vci/v1/credential-offer/abc';

    beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => undefined));

    function failWith(status: number, error: unknown): void {
      walletServiceMock.fetchTextFromUrl.mockReturnValue(
        throwError(() => new HttpErrorResponse({ status, statusText: 'x', url: OFFER_URI, error })),
      );
    }

    it('turns 410 + credential_offer_expired into CredentialOfferExpiredError', async () => {
      // responseType: 'text' → Angular leaves the Problem Details body as a raw string
      failWith(410, JSON.stringify({ type: 'credential_offer_expired', title: 'Credential offer expired', status: 410 }));

      await expect(service.getCredentialOfferFromCredentialOfferUri(OFFER_URI))
        .rejects.toBeInstanceOf(CredentialOfferExpiredError);
    });

    it('turns 404 + credential_offer_not_found into CredentialOfferNotFoundError', async () => {
      failWith(404, JSON.stringify({ type: 'credential_offer_not_found', title: 'Credential offer not found', status: 404 }));

      await expect(service.getCredentialOfferFromCredentialOfferUri(OFFER_URI))
        .rejects.toBeInstanceOf(CredentialOfferNotFoundError);
    });

    it.each([
      ['a 410 without body', 410, null],
      ['a 5xx', 502, '<html>Bad Gateway</html>'],
      ['a network error', 0, new ProgressEvent('error')],
      ['a 404 without a known type', 404, JSON.stringify({ type: 'no_such_element' })],
    ])('keeps the "cannot download" message for %s', async (_label, status, body) => {
      failWith(status, body);

      await expect(service.getCredentialOfferFromCredentialOfferUri(OFFER_URI))
        .rejects.toMatchObject({ translationKey: 'errors.cannot-download-credentialOffer' });
    });
  });

  it('unwraps a credential_offer_uri query param before fetching', async () => {
    const innerUri = 'https://sandbox.eudistack.net/issuer/oid4vci/v1/credential-offer/abc123';
    const wrappedUri = `openid-credential-offer://?credential_offer_uri=${encodeURIComponent(innerUri)}`;

    await service.getCredentialOfferFromCredentialOfferUri(wrappedUri);

    expect(walletServiceMock.fetchTextFromUrl).toHaveBeenCalledWith(innerUri);
  });
});
