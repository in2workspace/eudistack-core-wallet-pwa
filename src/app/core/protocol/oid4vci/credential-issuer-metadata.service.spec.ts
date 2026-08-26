import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { Oid4vciError } from '../../models/error/Oid4vciError';

// EUD-215: the well-known URL must follow OID4VCI 1.0 §12.2.2 — the
// well-known path is inserted between the origin and the issuer's own
// path, not appended after it. Coordinated with the CloudFront/ALB
// routing fix in eudistack-platform-iac; do not merge one without the other.

function buildCredentialOffer(credentialIssuer: string): CredentialOffer {
  return {
    credentialIssuer,
    credentialConfigurationsIds: ['eu.europa.ec.eudi.pid.1'],
    grant: {},
  };
}

function setup(fetchTextFromUrl: jest.Mock) {
  TestBed.configureTestingModule({
    providers: [
      CredentialIssuerMetadataService,
      { provide: WalletService, useValue: { fetchTextFromUrl } },
      { provide: UrlResolverService, useValue: { serverUrl: jest.fn() } },
    ],
  });
  return TestBed.inject(CredentialIssuerMetadataService);
}

describe('CredentialIssuerMetadataService', () => {
  it('inserts the well-known path before the issuer path (issuer identifier with a path)', async () => {
    const fetchTextFromUrl = jest.fn().mockReturnValue(of('{"credential_issuer":"https://sandbox.stg.eudistack.net/issuer"}'));
    const service = setup(fetchTextFromUrl);

    await service.getCredentialIssuerMetadataFromCredentialOffer(
      buildCredentialOffer('https://sandbox.stg.eudistack.net/issuer')
    );

    expect(fetchTextFromUrl).toHaveBeenCalledWith(
      'https://sandbox.stg.eudistack.net/.well-known/openid-credential-issuer/issuer'
    );
  });

  it('uses the bare well-known path when the issuer identifier has no path', async () => {
    const fetchTextFromUrl = jest.fn().mockReturnValue(of('{"credential_issuer":"https://issuer.dome-marketplace-sbx.org"}'));
    const service = setup(fetchTextFromUrl);

    await service.getCredentialIssuerMetadataFromCredentialOffer(
      buildCredentialOffer('https://issuer.dome-marketplace-sbx.org')
    );

    expect(fetchTextFromUrl).toHaveBeenCalledWith(
      'https://issuer.dome-marketplace-sbx.org/.well-known/openid-credential-issuer'
    );
  });

  it('throws when the credential offer has no credentialIssuer', async () => {
    const fetchTextFromUrl = jest.fn();
    const service = setup(fetchTextFromUrl);

    await expect(
      service.getCredentialIssuerMetadataFromCredentialOffer(buildCredentialOffer(''))
    ).rejects.toBeInstanceOf(Oid4vciError);
    expect(fetchTextFromUrl).not.toHaveBeenCalled();
  });
});
