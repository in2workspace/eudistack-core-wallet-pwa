import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { CredentialOfferService } from './credential-offer.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { TenantService } from 'src/app/core/services/tenant.service';

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
  let currentTenant: ReturnType<typeof signal<string | null>>;

  beforeEach(() => {
    currentTenant = signal<string | null>('sandbox');

    const resolveTenantIdFromUrl = jest.fn(async (url: string): Promise<string | null> => {
      try {
        const hostname = new URL(url).hostname;

        if (!hostname.includes('.')) {
          return null;
        }

        const first = hostname.split('.')[0].toLowerCase();
        const suffixes = ['-stg', '-dev', '-pre'] as const;
        const suffix = suffixes.find((s) => first.endsWith(s));

        return suffix ? first.slice(0, -suffix.length) : first;
      } catch {
        return null;
      }
    });

    const tenantServiceMock: Pick<TenantService, 'tenant' | 'resolveTenantIdFromUrl'> = {
      tenant: currentTenant.asReadonly(),
      resolveTenantIdFromUrl,
    };

    walletServiceMock = {
      fetchTextFromUrl: jest.fn().mockReturnValue(of(VALID_OFFER_JSON)),
    };

    TestBed.configureTestingModule({
      providers: [
        CredentialOfferService,
        { provide: WalletService, useValue: walletServiceMock },
        { provide: TenantService, useValue: tenantServiceMock },
      ],
    });

    service = TestBed.inject(CredentialOfferService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects a credential offer from a different tenant', async () => {
    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://kpmg.eudistack.net/issuer/credential-offer?id=abc',
      ),
    ).rejects.toMatchObject({ translationKey: 'errors.cross-tenant-offer' });
  });

  it('accepts a credential offer from the same tenant', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('accepts an offer from the same base tenant when the offer URI carries an env suffix', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://sandbox-stg.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('accepts an offer when the wallet is on a custom domain resolved to the same tenant', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://sandbox.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('rejects a cross-tenant offer even when the wallet is on a custom domain', async () => {
    await expect(
      service.getCredentialOfferFromCredentialOfferUri(
        'https://kpmg.eudistack.net/issuer/credential-offer?id=abc',
      ),
    ).rejects.toMatchObject({ translationKey: 'errors.cross-tenant-offer' });
  });

  it('skips tenant validation when the resolved tenant is null (unknown tenant)', async () => {
    currentTenant.set(null);

    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://kpmg.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('skips tenant validation when wallet runs on localhost (dev mode)', async () => {
    currentTenant.set('localhost');

    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'https://kpmg.eudistack.net/issuer/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('skips tenant validation when offer comes from an internal hostname (no dots)', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri(
      'http://issuer-service:8080/credential-offer?id=abc',
    );

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });

  it('does not throw cross-tenant error for a malformed offer URI', async () => {
    const offer = await service.getCredentialOfferFromCredentialOfferUri('::not-a-url');

    expect(offer.credentialIssuer).toBe('https://sandbox.eudistack.net/issuer');
  });
});