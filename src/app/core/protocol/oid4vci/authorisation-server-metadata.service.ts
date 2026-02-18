import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CONTENT_TYPE, CONTENT_TYPE_APPLICATION_JSON } from 'src/app/constants/content-type.constants';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';

@Injectable({ providedIn: 'root' })
export class AuthorisationServerMetadataService {

  private readonly http = inject(HttpClient);

  async getAuthorizationServerMetadataFromCredentialIssuerMetadata(
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): Promise<AuthorisationServerMetadata> {
    try {
      const responseText = await this.getAuthorizationServerMetadata(credentialIssuerMetadata);
      return this.parseAuthorisationServerMetadataResponse(responseText);
    } catch (e: any) {
      const reason = typeof e?.message === 'string' ? e.message : String(e);
      throw new Error(
        `Error while processing Authorisation Server Metadata Response from the Auth Server. Reason: ${reason}`
      );
    }
  }

  private async getAuthorizationServerMetadata(
    credentialIssuerMetadata: CredentialIssuerMetadata
  ): Promise<string> {
    const authServer =
      credentialIssuerMetadata.authorizationServer ?? credentialIssuerMetadata.credentialIssuer;

    if (!authServer || authServer.trim().length === 0) {
      throw new Error('Missing required field: authorizationServer/credentialIssuer');
    }

    const headers = new HttpHeaders({
      [CONTENT_TYPE]: CONTENT_TYPE_APPLICATION_JSON,
    });

    const url = `${authServer}/.well-known/openid-configuration`;

    try {
      return await firstValueFrom(this.http.get(url, { headers, responseType: 'text' }));
    } catch (e) {
      throw e as HttpErrorResponse;
    }
  }

  private parseAuthorisationServerMetadataResponse(responseText: string): AuthorisationServerMetadata {
    try {
      const root = JSON.parse(responseText);

      // Keep it permissive like @JsonIgnoreProperties(ignoreUnknown = true)
      return {
        issuer: root?.issuer,
        tokenEndpoint: root?.token_endpoint ?? root?.tokenEndpoint,
        authorizationEndpoint: root?.authorization_endpoint ?? root?.authorizationEndpoint,
        jwksUri: root?.jwks_uri ?? root?.jwksUri,
        ...root,
      };
    } catch (e: any) {
      const reason = typeof e?.message === 'string' ? e.message : String(e);
      throw new Error(`Error while deserializing Credential Issuer Metadata. Reason: ${reason}`);
    }
  }
}