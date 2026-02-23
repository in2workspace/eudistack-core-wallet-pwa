import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { WalletService } from 'src/app/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { retryUserMessage, wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';

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

      const errorMsg = 'Could not process authorization server metadata';
      throw new Oid4vciError(errorMsg, {
        cause: e,
        userMessage: retryUserMessage(errorMsg),
      });
    }
  }

  private async getAuthorizationServerMetadata(
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): Promise<string> {
    const authServer =
      credentialIssuerMetadata.authorizationServer ?? credentialIssuerMetadata.credentialIssuer;

    if (!authServer || authServer.trim().length === 0) {
      const errorMsg = 'Missing required field: authorizationServer/credentialIssuer';
      throw new Oid4vciError(errorMsg, {
        userMessage: retryUserMessage('Invalid issuer configuration'),
      });
    }

    const url = `${authServer}/.well-known/openid-configuration`;

    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(url));
    } catch (e: unknown) {
      const errorMsg = 'Could not download authorization server metadata';
      wrapOid4vciHttpError(e, errorMsg, {
        userMessage: retryUserMessage(errorMsg),
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
      const baseMessage = 'Invalid authorization server metadata';
      throw new Oid4vciError(`${baseMessage} (malformed JSON)`, {
        cause: e,
        userMessage: retryUserMessage(baseMessage),
      });
    }
  }
}