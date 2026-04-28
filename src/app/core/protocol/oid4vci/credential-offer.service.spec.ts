import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CredentialOfferService } from './credential-offer.service';
import { WalletService } from 'src/app/core/services/wallet.service';

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

describe('CredentialOfferService — validateOfferUriTenant', () => {
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

  it('rejects a credential offer from a different tenant', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'sandbox.eudistack.net' },
      configurable: true,
    });

    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://kpmg.eudistack.net/issuer/credential-offer?id=abc'
      )
    ).rejects.toMatchObject({ translationKey: 'errors.cross-tenant-offer' });
  });

  it('accepts a credential offer from the same tenant', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'sandbox.eudistack.net' },
      configurable: true,
    });

    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://sandbox.eudistack.net/issuer/credential-offer?id=abc'
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('skips tenant validation when wallet runs on localhost (no subdomain)', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'localhost' },
      configurable: true,
    });

    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://kpmg.eudistack.net/issuer/credential-offer?id=abc'
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('skips tenant validation when offer comes from an internal hostname (no dots)', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'sandbox.eudistack.net' },
      configurable: true,
    });

    // 'issuer-service' has no dot → extractSubdomain returns null → early return
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'http://issuer-service:8080/credential-offer?id=abc'
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('does not throw cross-tenant error for a malformed offer URI', async () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'sandbox.eudistack.net' },
      configurable: true,
    });

    // '::not-a-url' fails new URL() inside validateOfferUriTenant → catch → early return
    const offer = await service.getCredentialOfferFromCredentialOfferUri('::not-a-url');

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });
});
