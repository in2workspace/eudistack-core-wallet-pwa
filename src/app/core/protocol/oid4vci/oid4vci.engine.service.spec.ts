import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Oid4vciEngineService } from './oid4vci.engine.service';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { LoaderHandledFlowService } from 'src/app/services/loader-handled-flow.service';
import { LoaderService } from 'src/app/services/loader.service';
import { ToastServiceHandler } from 'src/app/services/toast.service';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { CredentialService } from './credential.service';
import { ProofBuilderService } from './proof-builder.service';
import { JwtService } from './jwt.service';
import { WalletService } from 'src/app/services/wallet.service';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { CredentialResponseWithStatus } from '../../models/CredentialResponseWithStatus';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { JwtParseError } from '../../models/error/JwtParseError';
import { AppError } from 'src/app/interfaces/error/AppError';

describe('Oid4vciEngineService', () => {
  let service: Oid4vciEngineService;

  beforeAll(() => {
    if (!globalThis.crypto.randomUUID) {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: () => 'test-uuid',
        configurable: true,
      });
    }
  });
  let mockKeyStorageProvider: {
    checkBrowserCompatibility: jest.Mock;
    generateKeyPair?: jest.Mock;
    sign?: jest.Mock;
    isCnfBoundToPublicKey?: jest.Mock;
  };
  let mockCredentialOfferService: { getCredentialOfferFromCredentialOfferUri: jest.Mock };
  let mockCredentialIssuerMetadataService: { getCredentialIssuerMetadataFromCredentialOffer: jest.Mock };
  let mockAuthorisationServerMetadataService: { getAuthorizationServerMetadataFromCredentialIssuerMetadata: jest.Mock };
  let mockPreAuthorizedTokenService: { getPreAuthorizedToken: jest.Mock };
  let mockCredentialService: { getCredential: jest.Mock };
  let mockWalletService: { finalizeCredentialIssuance: jest.Mock };
  let mockLoaderHandledFlowService: { run: jest.Mock };
  let mockLoader: { addLoadingProcess: jest.Mock; removeLoadingProcess: jest.Mock };
  let mockToastServiceHandler: { showErrorAlertByTranslateLabel: jest.Mock };
  let mockProofBuilderService: { buildHeaderAndPayload: jest.Mock };
  let mockJwtService: { base64UrlEncode: jest.Mock; parseJwtPayload: jest.Mock };

  const mockToastPipeSubscribe = { pipe: jest.fn().mockReturnValue({ subscribe: jest.fn() }) };

  const mockPublicKeyJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };

  const mockCredentialOffer: CredentialOffer = {
    credentialIssuer: 'https://issuer.example',
    credentialConfigurationsIds: ['config1'],
    grant: {
      preAuthorizedCodeGrant: {
        preAuthorizedCode: 'pre-auth-code-123',
        userPinRequired: false,
      },
    },
  };

  const mockCredentialIssuerMetadata: CredentialIssuerMetadata = {
    credentialIssuer: 'https://issuer.example',
    credentialEndpoint: 'https://issuer.example/credential',
    credential_configurations_supported: {
      config1: {
        format: 'jwt_vc_json',
        cryptographic_binding_methods_supported: [],
      },
    },
  };

  const mockCredentialIssuerMetadataWithCrypto: CredentialIssuerMetadata = {
    ...mockCredentialIssuerMetadata,
    credential_configurations_supported: {
      config1: {
        format: 'jwt_vc_json',
        cryptographic_binding_methods_supported: ['jwk'],
      },
    },
  };

  const createCredentialJwtWithCnf = (cnf: unknown): string => {
    const payload = { cnf };
    const payloadJson = JSON.stringify(payload);
    const payloadB64 = btoa(payloadJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return `header.${payloadB64}.signature`;
  };

  const mockAuthorisationServerMetadata: AuthorisationServerMetadata = {
    tokenEndpoint: 'https://as.example/token',
  };

  const mockTokenResponse = { access_token: 'mock-access-token' };

  const mockCredentialResponseWithStatus: CredentialResponseWithStatus = {
    credentialResponse: {
      credentials: [{ credential: 'header.payload.signature' }],
    },
    status: 200,
  };

  beforeEach(() => {
    mockKeyStorageProvider = {
      checkBrowserCompatibility: jest.fn().mockResolvedValue('indexed-db'),
    };

    mockCredentialOfferService = {
      getCredentialOfferFromCredentialOfferUri: jest.fn().mockResolvedValue(mockCredentialOffer),
    };

    mockCredentialIssuerMetadataService = {
      getCredentialIssuerMetadataFromCredentialOffer: jest.fn().mockResolvedValue(mockCredentialIssuerMetadata),
    };

    mockAuthorisationServerMetadataService = {
      getAuthorizationServerMetadataFromCredentialIssuerMetadata: jest.fn().mockResolvedValue(mockAuthorisationServerMetadata),
    };

    mockPreAuthorizedTokenService = {
      getPreAuthorizedToken: jest.fn().mockResolvedValue(mockTokenResponse),
    };

    mockCredentialService = {
      getCredential: jest.fn().mockResolvedValue(mockCredentialResponseWithStatus),
    };

    mockWalletService = {
      finalizeCredentialIssuance: jest.fn().mockReturnValue(of(undefined)),
    };

    mockLoaderHandledFlowService = {
      run: jest.fn(async (params: { fn: () => Promise<void> }) => params.fn()),
    };

    mockLoader = {
      addLoadingProcess: jest.fn(),
      removeLoadingProcess: jest.fn(),
    };

    mockToastServiceHandler = {
      showErrorAlertByTranslateLabel: jest.fn().mockReturnValue(mockToastPipeSubscribe),
    };

    mockProofBuilderService = {
      buildHeaderAndPayload: jest.fn().mockReturnValue({
        header: { alg: 'ES256', typ: 'openid4vci-proof+jwt', jwk: mockPublicKeyJwk },
        payload: { aud: ['https://issuer.example'], iat: 0, exp: 864000, nonce: '' },
      }),
    };

    mockJwtService = {
      base64UrlEncode: jest.fn((bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      ),
      parseJwtPayload: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        Oid4vciEngineService,
        { provide: WebCryptoKeyStorageProvider, useValue: mockKeyStorageProvider },
        { provide: LoaderHandledFlowService, useValue: mockLoaderHandledFlowService },
        { provide: LoaderService, useValue: mockLoader },
        { provide: ToastServiceHandler, useValue: mockToastServiceHandler },
        { provide: CredentialOfferService, useValue: mockCredentialOfferService },
        { provide: CredentialIssuerMetadataService, useValue: mockCredentialIssuerMetadataService },
        { provide: AuthorisationServerMetadataService, useValue: mockAuthorisationServerMetadataService },
        { provide: PreAuthorizedTokenService, useValue: mockPreAuthorizedTokenService },
        { provide: CredentialService, useValue: mockCredentialService },
        { provide: ProofBuilderService, useValue: mockProofBuilderService },
        { provide: JwtService, useValue: mockJwtService },
        { provide: WalletService, useValue: mockWalletService },
      ],
    });
    service = TestBed.inject(Oid4vciEngineService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('init()', () => {
    it('should call checkBrowserCompatibility and resolve', async () => {
      mockKeyStorageProvider.checkBrowserCompatibility.mockResolvedValue('indexed-db');

      await service.init();

      expect(mockKeyStorageProvider.checkBrowserCompatibility).toHaveBeenCalledTimes(1);
    });

    it('should call checkBrowserCompatibility only once when init is invoked multiple times', async () => {
      mockKeyStorageProvider.checkBrowserCompatibility.mockResolvedValue('indexed-db');

      await Promise.all([service.init(), service.init(), service.init()]);

      expect(mockKeyStorageProvider.checkBrowserCompatibility).toHaveBeenCalledTimes(1);
    });

    it('should show error toast when key storage mode is unavailable', async () => {
      mockKeyStorageProvider.checkBrowserCompatibility.mockResolvedValue('unavailable');

      await service.init();

      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.key-storage-unavailable');
    });

    it('should show warning toast when key storage mode is in-memory', async () => {
      mockKeyStorageProvider.checkBrowserCompatibility.mockResolvedValue('in-memory');

      await service.init();

      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.key-storage-in-memory');
    });

    it('should show error toast and rethrow when checkBrowserCompatibility throws', async () => {
      const error = new Error('Browser compatibility check failed');
      mockKeyStorageProvider.checkBrowserCompatibility.mockRejectedValue(error);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.init()).rejects.toThrow('Browser compatibility check failed');
      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.browser-compatibility-check-failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Oid4vciEngine] Browser compatibility check threw error:', error);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('executeOid4vciFlow()', () => {
    it('should complete the flow successfully without cryptographic binding', async () => {
      const credentialOfferUri = 'openid-credential-offer://?credential_offer=example';

      await service.executeOid4vciFlow(credentialOfferUri);

      expect(mockCredentialOfferService.getCredentialOfferFromCredentialOfferUri).toHaveBeenCalledWith(credentialOfferUri);
      expect(mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer).toHaveBeenCalledWith(mockCredentialOffer);
      expect(mockAuthorisationServerMetadataService.getAuthorizationServerMetadataFromCredentialIssuerMetadata).toHaveBeenCalledWith(mockCredentialIssuerMetadata);
      expect(mockPreAuthorizedTokenService.getPreAuthorizedToken).toHaveBeenCalledWith(mockCredentialOffer, mockAuthorisationServerMetadata);
      expect(mockCredentialService.getCredential).toHaveBeenCalled();
      expect(mockWalletService.finalizeCredentialIssuance).toHaveBeenCalled();
      expect(mockLoader.removeLoadingProcess).toHaveBeenCalled();
      expect(mockLoader.addLoadingProcess).toHaveBeenCalled();
    });

    it('should complete the flow successfully with cryptographic binding and cnf validation', async () => {
      mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer.mockResolvedValue(mockCredentialIssuerMetadataWithCrypto);
      mockKeyStorageProvider.generateKeyPair = jest.fn().mockResolvedValue({
        keyId: 'key-1',
        publicKeyJwk: mockPublicKeyJwk,
        kid: 'kid-1',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
      });
      mockKeyStorageProvider.sign = jest.fn().mockResolvedValue(new Uint8Array(64));
      mockKeyStorageProvider.isCnfBoundToPublicKey = jest.fn().mockResolvedValue(true);
      mockCredentialService.getCredential.mockResolvedValue({
        credentialResponse: {
          credentials: [{ credential: createCredentialJwtWithCnf({ jwk: mockPublicKeyJwk }) }],
        },
        status: 200,
      });
      mockJwtService.parseJwtPayload.mockReturnValue({ cnf: { jwk: mockPublicKeyJwk } });

      await service.executeOid4vciFlow('openid-credential-offer://?credential_offer=example');

      expect(mockKeyStorageProvider.generateKeyPair).toHaveBeenCalled();
      expect(mockProofBuilderService.buildHeaderAndPayload).toHaveBeenCalled();
      expect(mockKeyStorageProvider.sign).toHaveBeenCalled();
      expect(mockCredentialService.getCredential).toHaveBeenCalled();
      expect(mockKeyStorageProvider.isCnfBoundToPublicKey).toHaveBeenCalled();
      expect(mockWalletService.finalizeCredentialIssuance).toHaveBeenCalled();
    });

    it('should throw when issuer metadata has missing credential_configurations_supported', async () => {
      mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer.mockResolvedValueOnce({
        ...mockCredentialIssuerMetadata,
        credential_configurations_supported: undefined as unknown as CredentialIssuerMetadata['credential_configurations_supported'],
      });

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(Oid4vciError);
    });

    it('should throw when credential offer has missing credentialConfigurationIds', async () => {
      mockCredentialOfferService.getCredentialOfferFromCredentialOfferUri.mockResolvedValueOnce({
        ...mockCredentialOffer,
        credentialConfigurationsIds: [],
      });

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(Oid4vciError);
    });

    it('should throw when credential response has missing credential JWT', async () => {
      mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer.mockResolvedValue(mockCredentialIssuerMetadataWithCrypto);
      mockKeyStorageProvider.generateKeyPair = jest.fn().mockResolvedValue({
        keyId: 'key-1',
        publicKeyJwk: mockPublicKeyJwk,
        kid: 'kid-1',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
      });
      mockKeyStorageProvider.sign = jest.fn().mockResolvedValue(new Uint8Array(64));
      mockCredentialService.getCredential.mockResolvedValue({
        credentialResponse: { credentials: [{}] },
        status: 200,
      });

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(Oid4vciError);
    });

    it('should throw when JWT payload parse fails in validateCredentialCnf', async () => {
      mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer.mockResolvedValue(mockCredentialIssuerMetadataWithCrypto);
      mockKeyStorageProvider.generateKeyPair = jest.fn().mockResolvedValue({
        keyId: 'key-1',
        publicKeyJwk: mockPublicKeyJwk,
        kid: 'kid-1',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
      });
      mockKeyStorageProvider.sign = jest.fn().mockResolvedValue(new Uint8Array(64));
      mockCredentialService.getCredential.mockResolvedValue({
        credentialResponse: {
          credentials: [{ credential: 'invalid-jwt' }],
        },
        status: 200,
      });
      mockJwtService.parseJwtPayload.mockImplementation(() => {
        throw new JwtParseError('Invalid JWT format');
      });

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(Oid4vciError);
    });

    it('should throw when validateCredentialCnf detects cnf mismatch', async () => {
      mockCredentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer.mockResolvedValue(mockCredentialIssuerMetadataWithCrypto);
      mockKeyStorageProvider.generateKeyPair = jest.fn().mockResolvedValue({
        keyId: 'key-1',
        publicKeyJwk: mockPublicKeyJwk,
        kid: 'kid-1',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
      });
      mockKeyStorageProvider.sign = jest.fn().mockResolvedValue(new Uint8Array(64));
      mockKeyStorageProvider.isCnfBoundToPublicKey = jest.fn().mockResolvedValue(false);
      mockCredentialService.getCredential.mockResolvedValue({
        credentialResponse: {
          credentials: [{ credential: createCredentialJwtWithCnf({ jwk: mockPublicKeyJwk }) }],
        },
        status: 200,
      });
      mockJwtService.parseJwtPayload.mockReturnValue({ cnf: { jwk: mockPublicKeyJwk } });

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(Oid4vciError);
    });

    it('should propagate error when credentialOfferService fails', async () => {
      const error = new Error('Failed to fetch credential offer');
      mockCredentialOfferService.getCredentialOfferFromCredentialOfferUri.mockRejectedValue(error);

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow('Failed to fetch credential offer');
    });

    it('should propagate error when credentialService fails', async () => {
      const error = new Error('Failed to get credential');
      mockCredentialService.getCredential.mockRejectedValue(error);

      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow('Failed to get credential');
    });

    it('should not show toast when AppError has code user_cancelled', async () => {
      mockLoaderHandledFlowService.run.mockImplementation(async (params: { fn: () => Promise<void>; errorToTranslationKey: (e: unknown) => string | null }) => {
        try {
          return await params.fn();
        } catch (e) {
          const key = params.errorToTranslationKey(e);
          if (key) mockToastServiceHandler.showErrorAlertByTranslateLabel(key);
          throw e;
        }
      });
      mockCredentialService.getCredential.mockRejectedValue(new AppError('User cancelled', { code: 'user_cancelled' }));

      mockToastServiceHandler.showErrorAlertByTranslateLabel.mockClear();
      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(AppError);
      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel).not.toHaveBeenCalled();
    });

    it('should show toast with translationKey when AppError has translationKey', async () => {
      mockLoaderHandledFlowService.run.mockImplementation(async (params: { fn: () => Promise<void>; errorToTranslationKey: (e: unknown) => string | null }) => {
        try {
          return await params.fn();
        } catch (e) {
          const key = params.errorToTranslationKey(e);
          if (key) mockToastServiceHandler.showErrorAlertByTranslateLabel(key);
          throw e;
        }
      });
      mockCredentialService.getCredential.mockRejectedValue(new AppError('Custom error', { translationKey: 'errors.custom' }));

      mockToastServiceHandler.showErrorAlertByTranslateLabel.mockClear();
      await expect(service.executeOid4vciFlow('https://example.com/offer')).rejects.toThrow(AppError);
      expect(mockToastServiceHandler.showErrorAlertByTranslateLabel).toHaveBeenCalledWith('errors.custom');
    });
  });
});