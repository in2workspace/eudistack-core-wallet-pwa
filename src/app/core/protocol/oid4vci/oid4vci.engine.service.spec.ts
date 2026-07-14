import { TestBed } from '@angular/core/testing';
import { Oid4vciEngineService } from './oid4vci.engine.service';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { ProofBuilderService } from './proof-builder.service';
import { JwtService } from './jwt.service';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { CredentialService } from './credential.service';
import { LoaderHandledFlowService } from 'src/app/shared/services/loader-handled-flow.service';
import { AuthorizationCodeTokenService } from './authorization-code-token.service';
import { NonceService } from './nonce.service';
import { DpopService } from './dpop.service';
import { PublicKeyInfo } from '../../models/StoredKeyRecord';

// EUDISTACK-645: the holder-key id must be minted once per issued credential (ADR-021),
// never derived from the shared `{issuer}:{credentialConfigurationId}` pair — that shape
// caused a hard 409 in hybrid mode and silent key reuse in DB mode on a second credential
// of the same type.

function buildKeyInfo(keyId: string): PublicKeyInfo {
  return {
    keyId,
    algorithm: 'ES256',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' },
    kid: `kid-${keyId}`,
    createdAt: '2026-01-01T00:00:00Z',
    prebuiltJwsProof: `proof-${keyId}`,
  };
}

function buildKeyStorageProviderMock(): jest.Mocked<KeyStorageProvider> {
  return {
    init: jest.fn().mockResolvedValue(undefined),
    generateKeyPair: jest.fn(),
    sign: jest.fn(),
    hasKey: jest.fn(),
    deleteKey: jest.fn(),
    listKeys: jest.fn(),
    isCnfBoundToPublicKey: jest.fn(),
    resolveKeyIdByKid: jest.fn(),
    computeJwkThumbprint: jest.fn(),
  } as unknown as jest.Mocked<KeyStorageProvider>;
}

function setup(): { service: Oid4vciEngineService; keyStorageProvider: jest.Mocked<KeyStorageProvider> } {
  const keyStorageProvider = buildKeyStorageProviderMock();

  TestBed.configureTestingModule({
    providers: [
      Oid4vciEngineService,
      { provide: KeyStorageProvider, useValue: keyStorageProvider },
      { provide: ProofBuilderService, useValue: { createHeaderAndPayload: jest.fn() } },
      { provide: JwtService, useValue: { base64UrlEncode: jest.fn() } },
      { provide: CredentialOfferService, useValue: {} },
      { provide: CredentialIssuerMetadataService, useValue: {} },
      { provide: AuthorisationServerMetadataService, useValue: {} },
      { provide: PreAuthorizedTokenService, useValue: {} },
      { provide: LoaderService, useValue: { addLoadingProcess: jest.fn(), removeLoadingProcess: jest.fn() } },
      { provide: CredentialService, useValue: {} },
      { provide: LoaderHandledFlowService, useValue: { run: jest.fn() } },
      { provide: AuthorizationCodeTokenService, useValue: {} },
      { provide: NonceService, useValue: {} },
      { provide: DpopService, useValue: {} },
    ],
  });

  return { service: TestBed.inject(Oid4vciEngineService), keyStorageProvider };
}

describe('Oid4vciEngineService — holder key per credential (EUDISTACK-645)', () => {
  it('mints a distinct keyId per issueProofJwt call for the same issuer and credentialConfigurationId', async () => {
    const { service, keyStorageProvider } = setup();
    const firstCredentialId = '11111111-1111-4111-8111-111111111111';
    const secondCredentialId = '22222222-2222-4222-8222-222222222222';
    keyStorageProvider.generateKeyPair
      .mockResolvedValueOnce(buildKeyInfo(firstCredentialId))
      .mockResolvedValueOnce(buildKeyInfo(secondCredentialId));

    const paramsBase = {
      nonce: 'nonce-1',
      credentialIssuer: 'https://issuer.example',
      credentialConfigurationId: 'cfg-A',
      format: 'vc+sd-jwt',
      supportedAlgs: ['ES256'],
    };

    // Two credentials of the SAME type from the SAME issuer — the bug minted the same
    // `{issuer}:{credentialConfigurationId}` keyId for both; the fix mints one per call.
    const first = await (service as any).issueProofJwt({ ...paramsBase, credentialId: firstCredentialId });
    const second = await (service as any).issueProofJwt({ ...paramsBase, credentialId: secondCredentialId });

    expect(first.holderKeyId).toBe(firstCredentialId);
    expect(second.holderKeyId).toBe(secondCredentialId);
    expect(first.holderKeyId).not.toBe(second.holderKeyId);

    expect(keyStorageProvider.generateKeyPair).toHaveBeenNthCalledWith(
      1,
      'ES256',
      firstCredentialId,
      expect.objectContaining({ credentialId: firstCredentialId })
    );
    expect(keyStorageProvider.generateKeyPair).toHaveBeenNthCalledWith(
      2,
      'ES256',
      secondCredentialId,
      expect.objectContaining({ credentialId: secondCredentialId })
    );
  });

  it('never derives the keyId from issuer:credentialConfigurationId (regression guard)', async () => {
    const { service, keyStorageProvider } = setup();
    const credentialId = '33333333-3333-4333-8333-333333333333';
    keyStorageProvider.generateKeyPair.mockResolvedValueOnce(buildKeyInfo(credentialId));

    const credentialIssuer = 'https://issuer.example';
    const credentialConfigurationId = 'cfg-B';
    const legacySharedKeyId = `${credentialIssuer}:${credentialConfigurationId}`;

    await (service as any).issueProofJwt({
      nonce: 'nonce-2',
      credentialIssuer,
      credentialConfigurationId,
      format: 'vc+sd-jwt',
      supportedAlgs: ['ES256'],
      credentialId,
    });

    const [, actualKeyId] = keyStorageProvider.generateKeyPair.mock.calls[0];
    expect(actualKeyId).not.toBe(legacySharedKeyId);
    expect(actualKeyId).not.toContain(':');
    expect(actualKeyId).toBe(credentialId);
  });
});