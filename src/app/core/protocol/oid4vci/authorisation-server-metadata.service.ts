import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { WalletService } from 'src/app/core/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';

@Injectable({ providedIn: 'root' })
export class AuthorisationServerMetadataService {

  private readonly walletService = inject(WalletService);

  public async getAuthorizationServerMetadataFromCredentialIssuerMetadata(
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): Promise<AuthorisationServerMetadata> {
    try {
      const responseText = await this.getAuthorizationServerMetadata(credentialIssuerMetadata);
      return this.parseAuthorisationServerMetadataResponse(responseText);
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;

      throw new Oid4vciError('Could not process authorization server metadata', {
        cause: e,
        translationKey: 'errors.invalid-issuerMetadata',
      });
    }
  }

  private async getAuthorizationServerMetadata(
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): Promise<string> {
    const authServer =
      credentialIssuerMetadata.authorizationServer ?? credentialIssuerMetadata.credentialIssuer;

    if (!authServer || authServer.trim().length === 0) {
        throw new Oid4vciError('Missing required field: authorizationServer/credentialIssuer', {
          translationKey: 'errors.invalid-issuerMetadata',
        });
    }

    const url = `${authServer}/.well-known/openid-configuration`;

    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(url));
    } catch (e: unknown) {
      wrapOid4vciHttpError(e, 'Could not download authorization server metadata', {
        translationKey: 'errors.cannot-download-auth-server-metadata',
      });
    }
  }

  private parseAuthorisationServerMetadataResponse(responseText: string): AuthorisationServerMetadata {
    try {
      const root = JSON.parse(responseText);

      return {
        issuer: root?.issuer,
        tokenEndpoint: root?.token_endpoint ?? root?.tokenEndpoint,
        authorizationEndpoint: root?.authorization_endpoint ?? root?.authorizationEndpoint,
        jwksUri: root?.jwks_uri ?? root?.jwksUri,
        ...root,
      };
    } catch (e: any) {
       throw new Oid4vciError('Invalid authorization server metadata (malformed JSON)', {
        cause: e,
        translationKey: 'errors.invalid-issuerMetadata',
      });
    }
  }
}