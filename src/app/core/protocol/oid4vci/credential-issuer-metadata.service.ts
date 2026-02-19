import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { environment } from 'src/environments/environment';
import { WalletService } from 'src/app/services/wallet.service';



@Injectable({ providedIn: 'root' })
export class CredentialIssuerMetadataService {

  private readonly walletService = inject(WalletService);

  async getCredentialIssuerMetadataFromCredentialOffer(
    credentialOffer: CredentialOffer
  ): Promise<CredentialIssuerMetadata> {
    const credentialIssuerURL = `${credentialOffer.credentialIssuer}/.well-known/openid-credential-issuer`;

    try {
      const responseText = await this.getCredentialIssuerMetadata(credentialIssuerURL);
      return this.parseCredentialIssuerMetadataResponse(responseText);
    } catch (e) {
      throw new Error('Error while processing Credential Issuer Metadata from the Issuer');
    }
  }

  private async getCredentialIssuerMetadata(credentialIssuerURL: string): Promise<string> {

    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(credentialIssuerURL));
    } catch (e) {
      throw e as HttpErrorResponse;
    }
  }

  private parseCredentialIssuerMetadataResponse(responseText: string): CredentialIssuerMetadata {
    let root: any;

    try {
      root = JSON.parse(responseText);
    } catch (e) {
      throw new Error('Error while deserializing Credential Issuer Metadata: invalid JSON');
    }

    if (root && typeof root === 'object' && 'credential_token' in root) {
      const original = this.mapCredentialIssuerMetadata(root);

      return {
        credentialIssuer: original.credentialIssuer,
        credentialEndpoint: original.credentialEndpoint,
        credentialsSupported: original.credentialsSupported,
        deferredCredentialEndpoint: original.deferredCredentialEndpoint,
        authorizationServer: environment.iam_url,
        credentialToken: original.credentialToken,
        credential_configurations_supported: original.credential_configurations_supported,
      };
    }

    return this.mapCredentialIssuerMetadata(root);
  }

  /**
   * Map/normalize from wire JSON to DTO.
   */
  private mapCredentialIssuerMetadata(root: any): CredentialIssuerMetadata {
    //todo review
    if (!root || typeof root !== 'object') return {} as CredentialIssuerMetadata;

    return {
      credentialIssuer: root.credential_issuer ?? root.credentialIssuer,
      credentialEndpoint: root.credential_endpoint ?? root.credentialEndpoint,
      deferredCredentialEndpoint: root.deferred_credential_endpoint ?? root.deferredCredentialEndpoint,
      credentialsSupported: root.credentials_supported ?? root.credentialsSupported,
      authorizationServer: root.authorization_server ?? root.authorizationServer,
      credentialToken: root.credential_token ?? root.credentialToken,

      // Preserve unknown fields (similar to @JsonIgnoreProperties(ignoreUnknown = true))
      ...root,
    };
  }
}