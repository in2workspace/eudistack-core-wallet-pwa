import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { WalletService } from 'src/app/core/services/wallet.service';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';



@Injectable({ providedIn: 'root' })
export class CredentialIssuerMetadataService {

  private readonly walletService = inject(WalletService);
  private readonly urlResolver = inject(UrlResolverService);

  async getCredentialIssuerMetadataFromCredentialOffer(
  credentialOffer: CredentialOffer
  ): Promise<CredentialIssuerMetadata> {
    const issuer = credentialOffer?.credentialIssuer;

    if (!issuer || issuer.trim().length === 0) {
      throw new Oid4vciError('Missing credentialIssuer in credential offer', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }

    const credentialIssuerURL = this.buildWellKnownUrl(issuer);

    try {
      const responseText = await this.fetchCredentialIssuerMetadata(credentialIssuerURL);
      return this.parseCredentialIssuerMetadataResponse(responseText);
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;

      throw new Oid4vciError('Could not process issuer metadata', {
        cause: e,
        translationKey: 'errors.default',
      });
    }
  }

  /**
   * Builds the metadata URL per OID4VCI 1.0 §12.2.2: the well-known path is
   * inserted between the origin and the issuer's own path (not appended
   * after it), e.g. "https://host/tenant" -> "https://host/.well-known/openid-credential-issuer/tenant".
   */
  private buildWellKnownUrl(issuer: string): string {
    const issuerUrl = new URL(issuer);
    const issuerPath = issuerUrl.pathname === '/' ? '' : issuerUrl.pathname;
    return `${issuerUrl.origin}/.well-known/openid-credential-issuer${issuerPath}`;
  }

  private async fetchCredentialIssuerMetadata(credentialIssuerURL: string): Promise<string> {
    try {
      return await firstValueFrom(this.walletService.fetchTextFromUrl(credentialIssuerURL));
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
        authorizationServer: this.urlResolver.serverUrl(),
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
      nonceEndpoint: root.nonce_endpoint ?? root.nonceEndpoint,
      deferredCredentialEndpoint: root.deferred_credential_endpoint ?? root.deferredCredentialEndpoint,
      credentialsSupported: root.credentials_supported ?? root.credentialsSupported,
      authorizationServer: root.authorization_server ?? root.authorizationServer,
      credentialToken: root.credential_token ?? root.credentialToken,

      ...root,
    };
  }
}