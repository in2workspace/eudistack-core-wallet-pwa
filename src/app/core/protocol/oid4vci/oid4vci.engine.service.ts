import { AuthorisationServerMetadata } from '../../models/AuthorisationServerMetadata';
import { CredentialResponseWithStatusCode, CredentialService } from './credential.service';
import { inject, Injectable } from '@angular/core';
import { CredentialOfferService } from './credential-offer.service';
import { CredentialIssuerMetadataService } from './credential-issuer-metadata.service';
import { AuthorisationServerMetadataService } from './authorisation-server-metadata.service';
import { AuthenticationService } from 'src/app/services/authentication.service';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { CredentialIssuerMetadata, CredentialsConfigurationsSuppported } from '../../models/CredentialIssuerMetadata';
import { CredentialOffer } from '../../models/CredentialOffer';
import { ProofBuilderService } from './proof-builder.service';
import { WebCryptoKeyStorageProvider } from '../../spi-impl/web-crypto-key-storage.service';
import { TokenResponse } from '../../models/TokenResponse';
import { HttpClient } from '@angular/common/http';
import { environment } from 'src/environments/environment';
import { SERVER_PATH } from 'src/app/constants/api.constants';
import { options } from 'src/app/services/wallet.service';
import { tap, firstValueFrom } from 'rxjs';
import { JwtService } from './jwt.service';

interface TempPostCredentialRequestBoyd{
  credentialResponseWithStatus: CredentialResponseWithStatusCode;
  tokenResponse: TokenResponse;
  issuerMetadata: CredentialIssuerMetadata;
  authorisationServerMetadata: AuthorisationServerMetadata;
  tokenObtainedAt: number; //Unix timestamp in seconds
  format: string;
}

interface CredentialConfigurationContext {
  credentialConfigurationId: string;
  configuration: CredentialsConfigurationsSuppported;
  format: string;
  isCryptographicBindingSupported: boolean;
}

type ProofJwtContext = {
  jwt: string;
  publicKeyJwk: JsonWebKey;
  thumbprint: string;
};

@Injectable({ providedIn: 'root' })
export class Oid4vciEngineService {
  private readonly authorisationServerMetadataService = inject(AuthorisationServerMetadataService);
  private readonly authService = inject(AuthenticationService);
  private readonly credentialIssuerMetadataService = inject(CredentialIssuerMetadataService);
  private readonly credentialOfferService = inject(CredentialOfferService);
  private readonly credentialService = inject(CredentialService);
  private readonly http = inject(HttpClient);
  private readonly jwtService =inject(JwtService);
  private readonly keyStorageProvider = inject(WebCryptoKeyStorageProvider);
  private readonly preAuthorizedTokenService = inject(PreAuthorizedTokenService);
  private readonly proofBuilderService = inject(ProofBuilderService);

  public async executeOid4vciFlow(credentialOfferUri: string): Promise<void> {
    
    // GET DATA FOR THE CREDENTIAL REQUEST
    const credentialOffer = await this.credentialOfferService.getCredentialOfferFromCredentialOfferUri(credentialOfferUri);
    console.log("Credential Offer:", credentialOffer);
    
    const credentialIssuerMetadata = await this.credentialIssuerMetadataService.getCredentialIssuerMetadataFromCredentialOffer(credentialOffer);
    console.log("Credential Issuer Metadata:", credentialIssuerMetadata);
    
    const authorisationServerMetadata = await this.authorisationServerMetadataService.getAuthorizationServerMetadataFromCredentialIssuerMetadata(credentialIssuerMetadata);
    console.log("Authorisation Server Metadata:", authorisationServerMetadata);

    const token = this.authService.getToken();
    console.log("Token:", token);
    
    const tokenResponse: TokenResponse = await this.preAuthorizedTokenService.getPreAuthorizedToken(credentialOffer, authorisationServerMetadata);
    console.log("tokenResponse:", tokenResponse);
    
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
      console.log("Validating cnf with proof public JWK:", proofPublicJwk);
      const credentialJwt = credentialResponseWithStatus.credentialResponse.credentials?.[0].credential;
      if (!credentialJwt || typeof credentialJwt !== 'string') throw Error("Credential JWT is null or has an invalid type.");
      const payload = this.jwtService.parseJwtPayload(credentialJwt) as any;
      const cnf = payload?.cnf;
      const isCnfValid = await this.keyStorageProvider.isCnfBoundToPublicKey(cnf, proofPublicJwk);

      if(!isCnfValid){
        throw new Error("The cnf of the credential doesn't match the stored public key.");
      }

      console.log("Cnf was validated.");
    }else{
      console.warn("Skipping cnf validation since no proof JWT was generated.");
    }

    // SEND THE CREDENTIAL RESPONSE TO THE API TO CALL THE NOTIFICATION ENDPOINT, SAVE THE CREDENTIAL AND HANDLE DEFERRED METADATA
    //todo the "post-credential" logic that is currently done by the API will be moved to the client

    //parse status code to match API expectations
    const credentialResponseWithStatusCode: CredentialResponseWithStatusCode = {
      statusCode: credentialResponseWithStatus.status, ...credentialResponseWithStatus
    }

    
    const tokenObtainedAt = Math.floor(Date.now() / 1000);
    return this.postCredentialResponseWithStatus({
      credentialResponseWithStatus: credentialResponseWithStatusCode,
      tokenResponse,
      issuerMetadata: credentialIssuerMetadata,
      authorisationServerMetadata,
      tokenObtainedAt,
      format
    });

  }


  private postCredentialResponseWithStatus(credResponse: TempPostCredentialRequestBoyd): Promise<void> {
      return firstValueFrom(this.http.post<void>(
          environment.server_url + SERVER_PATH.REQUEST_CREDENTIAL,
          { ...credResponse },
          options
        ).pipe(tap(() => console.log("Posted credential response with status to server"))));
  }

  private resolveCredentialConfigurationContext(
    credentialOffer: CredentialOffer,
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): CredentialConfigurationContext {
    const ids = credentialOffer.credentialConfigurationsIds;
    if (!ids || ids.length === 0) {
      throw new Error('Missing credentialConfigurationsIds in credential offer');
    }

    // todo handle multiple credential configurations
    const credentialConfigurationId = ids[0];

    const configs = credentialIssuerMetadata.credential_configurations_supported;
    if (!configs) {
      throw new Error('Missing credentialsConfigurationsSupported in CredentialIssuerMetadata');
    }

    const configuration = configs[credentialConfigurationId];
    if (!configuration) {
      throw new Error(`No configuration found for ID: ${credentialConfigurationId}`);
    }

    const format = configuration.format;
    if (!format) {
      throw new Error(`Missing format for credential configuration ID: ${credentialConfigurationId}`);
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
    return '';
  }
}