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

    // RFC 8414 §3: prefer /.well-known/oauth-authorization-server, fallback to OpenID Connect discovery
    const rfc8414Url = `${authServer}/.well-known/oauth-authorization-server`;
    const oidcUrl = `${authServer}/.well-known/openid-configuration`;

    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(rfc8414Url));
    } catch {
      // Fallback to OpenID Connect discovery path
      try {
        return await firstValueFrom(this.walletService.getTextFromUrl(oidcUrl));
      } catch (e: unknown) {
        wrapOid4vciHttpError(e, 'Could not download authorization server metadata', {
          translationKey: 'errors.cannot-download-auth-server-metadata',
        });
      }
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
        pushedAuthorizationRequestEndpoint: root?.pushed_authorization_request_endpoint,
        nonceEndpoint: root?.nonce_endpoint,
        requirePushedAuthorizationRequests: root?.require_pushed_authorization_requests,
        codeChallengeMethodsSupported: root?.code_challenge_methods_supported,
        dpopSigningAlgValuesSupported: root?.dpop_signing_alg_values_supported,
        tokenEndpointAuthMethodsSupported: root?.token_endpoint_auth_methods_supported,
        grantTypesSupported: root?.grant_types_supported,
        responseTypesSupported: root?.response_types_supported,
        authorizationResponseIssParameterSupported: root?.authorization_response_iss_parameter_supported,
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