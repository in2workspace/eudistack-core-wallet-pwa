import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { environment } from 'src/environments/environment';
import { WalletService } from 'src/app/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';



@Injectable({ providedIn: 'root' })
export class CredentialIssuerMetadataService {

  private readonly walletService = inject(WalletService);

  async getCredentialIssuerMetadataFromCredentialOffer(
  credentialOffer: CredentialOffer
  ): Promise<CredentialIssuerMetadata> {
    const issuer = credentialOffer?.credentialIssuer;

    if (!issuer || issuer.trim().length === 0) {
      throw new Oid4vciError('Missing credentialIssuer in credential offer', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }

    const credentialIssuerURL = `${issuer}/.well-known/openid-credential-issuer`;

    try {
      const responseText = await this.getCredentialIssuerMetadata(credentialIssuerURL);
      return this.parseCredentialIssuerMetadataResponse(responseText);
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;

      throw new Oid4vciError('Could not process issuer metadata', {
        cause: e,
        translationKey: 'errors.default',
      });
    }
  }

  private async getCredentialIssuerMetadata(credentialIssuerURL: string): Promise<string> {
    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(credentialIssuerURL));
    } catch (e: unknown) {
        wrapOid4vciHttpError(e, 'Could not download issuer metadata', {
          translationKey: 'errors.cannot-download-issuerMetadata',
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
        authorizationServer: environment.server_url,
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
      throw new Oid4vciError('Invalid issuer metadata (malformed JSON)', {
        cause: e,
        translationKey: 'errors.invalid-issuerMetadata',
      });
    }
  }

  /**
   * Map/normalize from wire JSON to DTO.
   */
  private mapCredentialIssuerMetadata(root: any): CredentialIssuerMetadata {
    if (!root || typeof root !== 'object') {
      throw new Oid4vciError('Invalid issuer metadata (not an object)', {
        translationKey: 'errors.invalid-issuerMetadata',
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