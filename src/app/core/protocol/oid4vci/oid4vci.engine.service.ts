import { ToastServiceHandler } from './../../../shared/services/toast.service';
import { inject, Injectable } from '@angular/core';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { ProofBuilderService } from './proof-builder.service';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { take } from 'rxjs';
import { JwtService } from './jwt.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { CredentialService } from './credential.service';
import { CredentialResponseWithStatus, CredentialResponseWithStatusCode } from '../../models/CredentialResponseWithStatus';
import { CredentialConfigurationContext } from '../../models/CredentialConfigurationContext';
import { FinalizeIssuancePayload } from '../../models/FinalizeIssuancePayload';
import { ProofJwtContext } from '../../models/ProofJwt';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { AppError } from 'src/app/core/models/error/AppError';
import { JwtParseError } from '../../models/error/JwtParseError';
import { LoaderHandledFlowService } from 'src/app/shared/services/loader-handled-flow.service';
import { AuthorizationCodeTokenService } from './authorization-code-token.service';
import { detectIssuanceProfile } from './issuance-profile.util';
import { NonceService } from './nonce.service';
import { DpopService } from './dpop.service';
import { TokenResponse } from '../../models/dto/TokenResponse';

@Injectable({ providedIn: 'root' })
export class Oid4vciEngineService {
  private readonly authorizationCodeTokenService = inject(AuthorizationCodeTokenService);
  private readonly authorisationServerMetadataService = inject(AuthorisationServerMetadataService);
  private readonly dpopService = inject(DpopService);
  private readonly credentialIssuerMetadataService = inject(CredentialIssuerMetadataService);
  private readonly credentialOfferService = inject(CredentialOfferService);
  private readonly credentialService = inject(CredentialService);
  private readonly jwtService = inject(JwtService);
  private readonly keyStorageProvider = inject(KeyStorageProvider);
  private readonly loader = inject(LoaderService);
  private readonly loaderHandledFlowService = inject(LoaderHandledFlowService);
  private readonly nonceService = inject(NonceService);
  private readonly preAuthorizedTokenService = inject(PreAuthorizedTokenService);
  private readonly proofBuilderService = inject(ProofBuilderService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);

  private hasWarnedKeyStorageMode = false;
  private initPromise: Promise<void> | null = null;



  public init(): Promise<void> {
    this.initPromise ??= this.checkBrowserCompatibilityWithKeyStorage();
    return this.initPromise;
  }

  public async executeOid4vciFlow(credentialOfferUri: string): Promise<FinalizeIssuancePayload> {
    await this.init();

    return this.loaderHandledFlowService.run({
    logPrefix: '[Oid4vciEngine]',
    errorToTranslationKey: (e) => this.errorToTranslationKey(e),
    fn: async () => {

      // GET DATA FOR THE CREDENTIAL REQUEST
      const credentialOffer = await this.credentialOfferService.getCredentialOfferFromCredentialOfferUri(credentialOfferUri);

      const credentialIssuerMetadata = await this.credentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer(credentialOffer);

      const authorisationServerMetadata = await this.authorisationServerMetadataService.getAuthorizationServerMetadataFromCredentialIssuerMetadata(credentialIssuerMetadata);

      // TOKEN ACQUISITION — branch by grant type
      const profile = detectIssuanceProfile(authorisationServerMetadata);
      let tokenResponse: TokenResponse;

      this.loader.removeLoadingProcess();

      if (credentialOffer.grant?.authorizationCodeGrant) {
        tokenResponse = await this.authorizationCodeTokenService.getToken(
          credentialOffer, authorisationServerMetadata, profile
        );
      } else {
        tokenResponse = await this.preAuthorizedTokenService.getPreAuthorizedToken(
          credentialOffer, authorisationServerMetadata
        );
      }

      this.loader.addLoadingProcess();
      const cfg = this.resolveCredentialConfigurationContext(credentialOffer, credentialIssuerMetadata);

      const nonce = authorisationServerMetadata.nonceEndpoint
        ? await this.nonceService.getNonce(authorisationServerMetadata.nonceEndpoint)
        : '';

      let jwtProof = null;
      let proofPublicJwk: JsonWebKey | null = null;

      if (cfg.isCryptographicBindingSupported && credentialIssuerMetadata.credentialIssuer) {
        const proofContext = await this.buildProofJwt({
          nonce,
          credentialIssuer: credentialIssuerMetadata.credentialIssuer
        });
        jwtProof = proofContext.jwt;
        proofPublicJwk = proofContext.publicKeyJwk;
      }

      const format = cfg.format;
      const credentialConfigurationId = cfg.credentialConfigurationId;

      // GET CREDENTIAL (with DPoP proof if token is DPoP-bound)
      let credentialDpopJwt: string | undefined;
      if (tokenResponse.token_type?.toLowerCase() === 'dpop' && credentialIssuerMetadata.credentialEndpoint) {
        const dpopProof = await this.dpopService.generateProof('POST', credentialIssuerMetadata.credentialEndpoint);
        credentialDpopJwt = dpopProof.jwt;
      }

      const credentialResponseWithStatus = await this.credentialService.getCredential({
        jwtProof,
        tokenResponse,
        credentialIssuerMetadata,
        format,
        credentialConfigurationId,
        dpopJwt: credentialDpopJwt,
      });

      // VALIDATE CNF FROM THE API RESPONSE
      if (jwtProof && proofPublicJwk) {
        await this.validateCredentialCnf(credentialResponseWithStatus, jwtProof, proofPublicJwk);
      }else{
        console.warn("Skipping cnf validation since no proof JWT was generated.");
      }

      const credentialResponseWithStatusCode: CredentialResponseWithStatusCode = {
        statusCode: credentialResponseWithStatus.status, ...credentialResponseWithStatus
      }

      const tokenObtainedAt = Math.floor(Date.now() / 1000);

      return {
        credentialResponseWithStatus: credentialResponseWithStatusCode,
        tokenResponse,
        issuerMetadata: credentialIssuerMetadata,
        authorisationServerMetadata,
        tokenObtainedAt,
        format
      };
    }});

  }

  private async checkBrowserCompatibilityWithKeyStorage(): Promise<void> {
    if(this.hasWarnedKeyStorageMode) return;

    await this.keyStorageProvider.init();

    // Browser-specific compatibility warnings only apply to WebCrypto mode
    if (this.keyStorageProvider instanceof WebCryptoKeyStorageProvider) {
      const mode = this.keyStorageProvider.storageMode;

      if (mode === 'unavailable') {
        this.toastServiceHandler.showErrorAlertByTranslateLabel("errors.key-storage-unavailable").pipe(
          take(1)
        ).subscribe();
        this.hasWarnedKeyStorageMode = true;
      }

      if (mode === 'public-only') {
        this.toastServiceHandler.showErrorAlertByTranslateLabel("errors.key-storage-public-only").pipe(
          take(1)
        ).subscribe();
        this.hasWarnedKeyStorageMode = true;
      }
    }
  }

  private errorToTranslationKey(e: unknown): string | null {
  if (e instanceof AppError) {
    if (e.code === 'user_cancelled') return null;
    return e.translationKey ?? 'errors.default';
  }
  return 'errors.default';
}

  private async validateCredentialCnf(
    credentialResponseWithStatus: CredentialResponseWithStatus,
    jwtProof: string | null,
    proofPublicJwk: JsonWebKey | null
  ): Promise<void> {
    if (!jwtProof || !proofPublicJwk) {
      console.warn("Skipping cnf validation since no proof JWT was generated.");
      return;
    }

    const credentialJwt = credentialResponseWithStatus.credentialResponse.credentials?.[0].credential;
    if (!credentialJwt || typeof credentialJwt !== 'string') {
      throw new Oid4vciError('Credential cnf validation failed (missing credential JWT)', {
        translationKey: 'errors.credential-validation-failed',
      });
    }

    let payload: any;
    try {
      payload = this.jwtService.parseJwtPayload(credentialJwt);
    } catch (e: unknown) {
      if (e instanceof JwtParseError) {
        throw new Oid4vciError('Credential JWT payload could not be parsed', {
          cause: e,
          translationKey: 'errors.invalid-jwt',
        });
      }
      throw e;
    }
    const cnf = payload?.cnf;

    const isCnfValid = await this.keyStorageProvider.isCnfBoundToPublicKey(cnf, proofPublicJwk);
    if (!isCnfValid) {
        throw new Oid4vciError("Credential cnf validation failed (cnf mismatch)", {
          translationKey: 'errors.credential-validation-failed',
        });
    }

  }

  private resolveCredentialConfigurationContext(
    credentialOffer: CredentialOffer,
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): CredentialConfigurationContext {
    const ids = credentialOffer.credentialConfigurationsIds;
    if (!ids || ids.length === 0) {
        throw new Oid4vciError('Invalid credential offer (missing credentialConfigurationIds)', {
          translationKey: 'errors.invalid-credentialOffer',
        });
    }

    // todo handle multiple credential configurations
    const credentialConfigurationId = ids[0];

    const configs = credentialIssuerMetadata.credential_configurations_supported;
    if (!configs) {
        throw new Oid4vciError('Invalid issuer metadata (missing credential_configurations_supported)', {
          translationKey: 'errors.invalid-issuerMetadata',
        });
    }

    const configuration = configs[credentialConfigurationId];
    if (!configuration) {
        throw new Oid4vciError(`Invalid issuer metadata (unknown configuration id: ${credentialConfigurationId})`, {
          translationKey: 'errors.invalid-issuerMetadata',
        });
    }

    const format = configuration.format;
    if (!format) {
        throw new Oid4vciError(`Invalid issuer metadata (missing format for configuration id: ${credentialConfigurationId})`, {
          translationKey: 'errors.invalid-issuerMetadata',
        });
    }

    const methods = configuration.cryptographic_binding_methods_supported;
    const isCryptographicBindingSupported = !!(methods && methods.length > 0);

    return {
      credentialConfigurationId,
      configuration,
      format,
      isCryptographicBindingSupported,
    };
  }

  private async buildProofJwt(params: { nonce: string; credentialIssuer: string; }): Promise<ProofJwtContext> {
    const keyInfo = await this.keyStorageProvider.generateKeyPair('ES256', globalThis.crypto.randomUUID());

    const publicKeyJwk = keyInfo.publicKeyJwk;

    const headerAndPayload = this.proofBuilderService.buildHeaderAndPayload(
      params.nonce,
      params.credentialIssuer,
      publicKeyJwk
    );
    const signingInput = this.buildSigningInput(headerAndPayload);

    const signature = await this.keyStorageProvider.sign(keyInfo.keyId, new TextEncoder().encode(signingInput));

    return { 
      jwt: `${signingInput}.${this.jwtService.base64UrlEncode(signature)}`, 
      publicKeyJwk, 
      thumbprint: keyInfo.kid 
    };
  }

  private buildSigningInput(parts: { header: unknown; payload: unknown }): string {
    const enc = new TextEncoder();
    const headerB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(parts.header)));
    const payloadB64 = this.jwtService.base64UrlEncode(enc.encode(JSON.stringify(parts.payload)));
    return `${headerB64}.${payloadB64}`;
  }

}