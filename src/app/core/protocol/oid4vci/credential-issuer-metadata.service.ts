import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { environment } from 'src/environments/environment';
import { WalletService } from 'src/app/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { retryUserMessage, wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';



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
      if (e instanceof Oid4vciError) throw e;

      const errorMsg = 'Could not process issuer metadata';
      throw new Oid4vciError(errorMsg, {
        cause: e,
        userMessage: retryUserMessage(errorMsg),
      });
    }
  }

  private async getCredentialIssuerMetadata(credentialIssuerURL: string): Promise<string> {
    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(credentialIssuerURL));
    } catch (e: unknown) {
        const errorMsg = 'Could not download issuer metadata';
        wrapOid4vciHttpError(e, errorMsg, {
        userMessage: retryUserMessage(errorMsg),
      });
    }
  }

  private parseCredentialIssuerMetadataResponse(responseText: string): CredentialIssuerMetadata {
    let root = this.parseJsonOrThrow(responseText);
    const mapped = this.mapCredentialIssuerMetadata(root);
    
    if (root && typeof root === 'object' && !Array.isArray(root) && 'credential_token' in root) {

      return {
        credentialIssuer: mapped.credentialIssuer,
        credentialEndpoint: mapped.credentialEndpoint,
        credentialsSupported: mapped.credentialsSupported,
        deferredCredentialEndpoint: mapped.deferredCredentialEndpoint,
        authorizationServer: environment.iam_url,
        credentialToken: mapped.credentialToken,
        credential_configurations_supported: mapped.credential_configurations_supported,
      };
    }

    return this.mapCredentialIssuerMetadata(mapped);
  }

  private parseJsonOrThrow(responseText: string): any {
    try {
      return JSON.parse(responseText);
    } catch (e: unknown) {
      const baseMessage = 'Invalid issuer metadata';
      throw new Oid4vciError(`${baseMessage} (malformed JSON)`, {
        cause: e,
        userMessage: retryUserMessage(baseMessage),
      });
    }
  }

  /**
   * Map/normalize from wire JSON to DTO.
   */
  private mapCredentialIssuerMetadata(root: any): CredentialIssuerMetadata {
    if (!root || typeof root !== 'object') {
      const baseMessage = 'Invalid issuer metadata';
      throw new Oid4vciError(`${baseMessage} (not an object)`, {
        userMessage: retryUserMessage(baseMessage),
      });
    }

    return {
      credentialIssuer: root.credential_issuer ?? root.credentialIssuer,
      credentialEndpoint: root.credential_endpoint ?? root.credentialEndpoint,
      deferredCredentialEndpoint: root.deferred_credential_endpoint ?? root.deferredCredentialEndpoint,
      credentialsSupported: root.credentials_supported ?? root.credentialsSupported,
      authorizationServer: root.authorization_server ?? root.authorizationServer,
      credentialToken: root.credential_token ?? root.credentialToken,

      ...root,
    };
  }
}