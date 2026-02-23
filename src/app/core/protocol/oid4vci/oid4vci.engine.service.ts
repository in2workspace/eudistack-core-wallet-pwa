import { ToastServiceHandler } from 'src/app/services/toast.service';
import { inject, Injectable } from '@angular/core';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { AuthenticationService } from 'src/app/services/authentication.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { ProofBuilderService } from './proof-builder.service';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { WalletService } from 'src/app/services/wallet.service';
import { firstValueFrom, take } from 'rxjs';
import { JwtService } from './jwt.service';
import { LoaderService } from 'src/app/services/loader.service';
import { CredentialService } from './credential.service';
import { CredentialResponseWithStatus, CredentialResponseWithStatusCode } from '../../models/CredentialResponseWithStatus';
import { CredentialConfigurationContext } from '../../models/CredentialConfigurationContext';
import { FinalizeIssuancePayload } from '../../models/FinalizeIssuancePayload';
import { ProofJwtContext } from '../../models/ProofJwt';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { retryUserMessage } from 'src/app/helpers/http-error-message';
import { AppError } from 'src/app/interfaces/error/AppError';

//todo in this class and all class invoked by this one, show popup when error happens and handle it
@Injectable({ providedIn: 'root' })
export class Oid4vciEngineService {
  private readonly authorisationServerMetadataService = inject(AuthorisationServerMetadataService);
  private readonly authService = inject(AuthenticationService);
  private readonly credentialIssuerMetadataService = inject(CredentialIssuerMetadataService);
  private readonly credentialOfferService = inject(CredentialOfferService);
  private readonly credentialService = inject(CredentialService);
  private readonly jwtService = inject(JwtService);
  private readonly keyStorageProvider = inject(WebCryptoKeyStorageProvider);
  private readonly loader = inject(LoaderService);
  private readonly preAuthorizedTokenService = inject(PreAuthorizedTokenService);
  private readonly proofBuilderService = inject(ProofBuilderService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly walletService = inject(WalletService);

  private hasWarnedKeyStorageMode = false;
  private readonly initPromise: Promise<void>;

   constructor() {
    this.initPromise = this.checkBrowserCompatibilityWithKeyStorage();
  }

  public async executeOid4vciFlow(credentialOfferUri: string): Promise<void> {
    //todo translate error messages
    await this.initPromise;
    
    try{
      //todo review loader, maybe not necessary at this level
      this.loader.addLoadingProcess();

      // GET DATA FOR THE CREDENTIAL REQUEST
      const credentialOffer = await this.credentialOfferService.getCredentialOfferFromCredentialOfferUri(credentialOfferUri);
      console.log("Credential Offer:", credentialOffer);
      
      const credentialIssuerMetadata = await this.credentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer(credentialOffer);
      console.log("Credential Issuer Metadata:", credentialIssuerMetadata);
      
      const authorisationServerMetadata = await this.authorisationServerMetadataService.getAuthorizationServerMetadataFromCredentialIssuerMetadata(credentialIssuerMetadata);
      console.log("Authorisation Server Metadata:", authorisationServerMetadata);

      const token = this.authService.getToken();
      console.log("Token:", token);
      
      this.loader.removeLoadingProcess();

      const tokenResponse = await this.preAuthorizedTokenService.getPreAuthorizedToken(credentialOffer, authorisationServerMetadata);
      console.log("tokenResponse:", tokenResponse);
      
      this.loader.addLoadingProcess();
      const cfg = this.resolveCredentialConfigurationContext(credentialOffer, credentialIssuerMetadata);
      console.log("Credential Configuration Context:", cfg);

      const nonce = this.getNonce();
      
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
      console.log("JWT Proof:", jwtProof);
      console.log("Proof Public JWK:", proofPublicJwk);
      
      const format = cfg.format;
      const credentialConfigurationId = cfg.credentialConfigurationId;
      
      // GET CREDENTIAL
      const credentialResponseWithStatus = await this.credentialService.getCredential({
        jwtProof, 
        tokenResponse,
        credentialIssuerMetadata,
        format,
        credentialConfigurationId
      });
      console.log("Credential response: ", credentialResponseWithStatus);

      // VALIDATE CNF FROM THE API RESPONSE
      if (jwtProof && proofPublicJwk) {
        await this.validateCredentialCnf(credentialResponseWithStatus, jwtProof, proofPublicJwk);
      }else{
        console.warn("Skipping cnf validation since no proof JWT was generated.");
      }

      // SEND THE CREDENTIAL RESPONSE TO THE API TO CALL THE NOTIFICATION ENDPOINT, SAVE THE CREDENTIAL AND HANDLE DEFERRED METADATA
      // todo the "post-credential" logic that is currently done by the API will be moved to the client

      // Parse status code to match API expectations
      // todo consider refactoring the API
      const credentialResponseWithStatusCode: CredentialResponseWithStatusCode = {
        statusCode: credentialResponseWithStatus.status, ...credentialResponseWithStatus
      }
      
      const tokenObtainedAt = Math.floor(Date.now() / 1000);

      return await this.sendCredentialToFinalizeCredentialIssuance({
        credentialResponseWithStatus: credentialResponseWithStatusCode,
        tokenResponse,
        issuerMetadata: credentialIssuerMetadata,
        authorisationServerMetadata,
        tokenObtainedAt,
        format
      });
    }catch(e: unknown){
      if (e instanceof AppError) {
        console.error('[Oid4vciEngine] Flow failed:', { message: e.message, code: e.code, cause: e.cause });
      } else {
        console.error('[Oid4vciEngine] Flow failed:', e);
      }
      const msg = this.errorToToastMessage(e);
      if (msg) {
        this.toastServiceHandler.showErrorAlert(msg).subscribe();
      }
      // If you don't want the caller to see errors, you can omit the throw.
      throw e;
    }finally{
      this.loader.removeLoadingProcess();
    }

  }

  private async checkBrowserCompatibilityWithKeyStorage(): Promise<void> {
    const mode = await this.keyStorageProvider.checkBrowserCompatibility();
    if(this.hasWarnedKeyStorageMode) return;

    if (mode === 'unavailable') {
      this.toastServiceHandler.showErrorAlert("Your browser does not support secure key storage. You wont't be able to activate nor send credentials").pipe(
        take(1)
      ).subscribe();
      this.hasWarnedKeyStorageMode = true;
    }

    if (mode === 'public-only') {
      this.toastServiceHandler.showErrorAlert("Your browser does not support secure key storage. You won't be able to use your credentials, and the credentials you add during this session will be unusable after leaving or reloading the page").pipe(
        take(1)
      ).subscribe();
      this.hasWarnedKeyStorageMode = true;
    }

  }

  private errorToToastMessage(e: unknown): string | null {
    if (e instanceof AppError) {
      if (e.code === 'user_cancelled') return null;
      return e.userMessage || e.message || 'Unexpected error';
    }
    if (e instanceof Error) return e.message || 'Unexpected error';
    return 'Unexpected error';
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

    console.log("Validating cnf with proof public JWK:", proofPublicJwk);

    const credentialJwt = credentialResponseWithStatus.credentialResponse.credentials?.[0].credential;
    if (!credentialJwt || typeof credentialJwt !== 'string') {
      throw new Oid4vciError("Credential cnf validation failed", {
        userMessage: retryUserMessage("Credential validation failed"),
      });
    }

    const payload = this.jwtService.parseJwtPayload(credentialJwt) as any;
    const cnf = payload?.cnf;

    const isCnfValid = await this.keyStorageProvider.isCnfBoundToPublicKey(cnf, proofPublicJwk);
    if (!isCnfValid) {
      throw new Error("The cnf of the credential doesn't match the stored public key.");
    }

    console.log("Cnf was validated.");
  }

  private sendCredentialToFinalizeCredentialIssuance(credResponse: FinalizeIssuancePayload): Promise<void> {
    //todo await?
      return firstValueFrom(this.walletService.finalizeCredentialIssuance(credResponse));
  }

  private resolveCredentialConfigurationContext(
    credentialOffer: CredentialOffer,
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): CredentialConfigurationContext {
    const ids = credentialOffer.credentialConfigurationsIds;
    if (!ids || ids.length === 0) {
      const baseMsg = 'Invalid credential offer';
      throw new Oid4vciError(`${baseMsg} (missing credentialConfigurationIds)`, {
      userMessage: retryUserMessage(baseMsg),
    });
    }

    // todo handle multiple credential configurations
    const credentialConfigurationId = ids[0];

    const configs = credentialIssuerMetadata.credential_configurations_supported;
    if (!configs) {
      const baseMsg = 'Invalid issuer metadata';
      throw new Oid4vciError(`${baseMsg} (missing credential_configurations_supported)`, {
      userMessage: retryUserMessage(baseMsg),
    });
    }

    const configuration = configs[credentialConfigurationId];
    if (!configuration) {
      const baseMsg = 'Invalid issuer metadata';
      throw new Oid4vciError(`${baseMsg} (unknown configuration id: ${credentialConfigurationId})`, {
      userMessage: retryUserMessage(baseMsg),
    });
    }

    const format = configuration.format;
    if (!format) {
      const baseMsg = 'Invalid issuer metadata';
      throw new Oid4vciError(`${baseMsg} (missing format for configuration id: ${credentialConfigurationId})`, {
      userMessage: retryUserMessage(baseMsg),
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
    console.log("Building proof JWT with params:", params);
    const keyInfo = await this.keyStorageProvider.generateKeyPair('ES256', crypto.randomUUID());
    console.log("Generated key info:", keyInfo);

    const publicKeyJwk = keyInfo.publicKeyJwk;

    const headerAndPayload = this.proofBuilderService.buildHeaderAndPayload(
      params.nonce,
      params.credentialIssuer,
      publicKeyJwk
    );
    console.log("Header and Payload for JWT:", headerAndPayload);

    //todo potser tindria més sentit fer que retorni directament tipus compatible amb Uint8Array<ArrayBufferLike> per a sign()
    const signingInput = this.buildSigningInput(headerAndPayload);
    console.log("Signing input for JWT:", signingInput);

    const signature = await this.keyStorageProvider.sign(keyInfo.keyId, new TextEncoder().encode(signingInput));
    console.log("Signature from key storage provider:", signature);

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

  // todo use nonce endpoint when it is supported
  private getNonce(): string {
    console.warn("Using '' as nonce, since nonce endpoint is not implemented yet.");
    return '';
  }
}