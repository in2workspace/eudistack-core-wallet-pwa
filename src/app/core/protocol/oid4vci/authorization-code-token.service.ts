import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { IssuanceProfile } from './issuance-profile.util';
import { PkceService } from './pkce.service';
import { DpopService } from './dpop.service';
import { WiaService } from './wia.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';
import { CONTENT_TYPE_URL_ENCODED_FORM } from 'src/app/core/constants/content-type.constants';

@Injectable({ providedIn: 'root' })
export class AuthorizationCodeTokenService {
  private readonly http = inject(HttpClient);
  private readonly pkceService = inject(PkceService);
  private readonly dpopService = inject(DpopService);
  private readonly wiaService = inject(WiaService);

  async getToken(
    credentialOffer: CredentialOffer,
    metadata: AuthorisationServerMetadata,
    profile: IssuanceProfile
  ): Promise<TokenResponse> {
    this.dpopService.reset();
    this.wiaService.reset();

    const codeVerifier = this.pkceService.generateCodeVerifier();
    const codeChallenge = await this.pkceService.generateCodeChallenge(codeVerifier);

    const issuerState = credentialOffer.grant?.authorizationCodeGrant?.issuerState;
    const scope = credentialOffer.credentialConfigurationsIds?.[0] ?? '';
    const redirectUri = 'http://localhost/callback';
    const state = globalThis.crypto.randomUUID();

    let authCode: string;

    if (profile === 'haip') {
      authCode = await this.executeHaipFlow({
        metadata, codeChallenge, scope, redirectUri, state, issuerState,
      });
    } else {
      authCode = await this.executePlainFlow({
        metadata, codeChallenge, scope, redirectUri, state, issuerState,
      });
    }

    return await this.exchangeCodeForToken({
      metadata, authCode, redirectUri, codeVerifier, profile,
    });
  }

  private async executeHaipFlow(params: {
    metadata: AuthorisationServerMetadata;
    codeChallenge: string;
    scope: string;
    redirectUri: string;
    state: string;
    issuerState?: string;
  }): Promise<string> {
    const parEndpoint = params.metadata.pushedAuthorizationRequestEndpoint;
    if (!parEndpoint) {
      throw new Oid4vciError('PAR endpoint missing in metadata (required for HAIP)', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const dpopProof = await this.dpopService.generateProof('POST', parEndpoint);
    const attestation = await this.wiaService.getAttestationHeaders(params.metadata.issuer ?? parEndpoint);

    const parBody = new URLSearchParams();
    parBody.set('response_type', 'code');
    parBody.set('scope', params.scope);
    parBody.set('code_challenge', params.codeChallenge);
    parBody.set('code_challenge_method', 'S256');
    parBody.set('redirect_uri', params.redirectUri);
    parBody.set('state', params.state);
    if (params.issuerState) {
      parBody.set('issuer_state', params.issuerState);
    }

    const parHeaders = new HttpHeaders()
      .set('Content-Type', CONTENT_TYPE_URL_ENCODED_FORM)
      .set('DPoP', dpopProof.jwt)
      .set('OAuth-Client-Attestation', attestation.wia)
      .set('OAuth-Client-Attestation-PoP', attestation.pop);

    let requestUri: string;
    try {
      const parResponse = await firstValueFrom(
        this.http.post<{ request_uri: string; expires_in: number }>(
          parEndpoint, parBody.toString(), { headers: parHeaders }
        )
      );
      requestUri = parResponse.request_uri;
    } catch (e: unknown) {
      wrapOid4vciHttpError(e, 'PAR request failed', {
        translationKey: 'errors.par-failed',
      });
    }

    return await this.callAuthorizeEndpoint({
      metadata: params.metadata,
      requestUri: requestUri!,
      state: params.state,
    });
  }

  private async executePlainFlow(params: {
    metadata: AuthorisationServerMetadata;
    codeChallenge: string;
    scope: string;
    redirectUri: string;
    state: string;
    issuerState?: string;
  }): Promise<string> {
    return await this.callAuthorizeEndpoint({
      metadata: params.metadata,
      codeChallenge: params.codeChallenge,
      scope: params.scope,
      redirectUri: params.redirectUri,
      state: params.state,
      issuerState: params.issuerState,
    });
  }

  private async callAuthorizeEndpoint(params: {
    metadata: AuthorisationServerMetadata;
    requestUri?: string;
    codeChallenge?: string;
    scope?: string;
    redirectUri?: string;
    state: string;
    issuerState?: string;
  }): Promise<string> {
    const authEndpoint = params.metadata.authorizationEndpoint;
    if (!authEndpoint) {
      throw new Oid4vciError('Authorization endpoint missing in metadata', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const queryParams = new URLSearchParams();
    if (params.requestUri) {
      queryParams.set('request_uri', params.requestUri);
    } else {
      queryParams.set('response_type', 'code');
      if (params.scope) queryParams.set('scope', params.scope);
      if (params.codeChallenge) {
        queryParams.set('code_challenge', params.codeChallenge);
        queryParams.set('code_challenge_method', 'S256');
      }
      if (params.redirectUri) queryParams.set('redirect_uri', params.redirectUri);
      if (params.issuerState) queryParams.set('issuer_state', params.issuerState);
    }
    queryParams.set('state', params.state);

    const authorizeUrl = `${authEndpoint}?${queryParams.toString()}`;

    try {
      const response = await firstValueFrom(
        this.http.get(authorizeUrl, { observe: 'response', responseType: 'text' })
      );

      const locationUrl = response.url ?? response.headers.get('Location');
      if (!locationUrl) {
        throw new Oid4vciError('Authorization response missing redirect URL', {
          translationKey: 'errors.authorization-failed',
        });
      }

      const redirectParams = new URL(locationUrl).searchParams;
      const code = redirectParams.get('code');
      if (!code) {
        const error = redirectParams.get('error');
        throw new Oid4vciError(`Authorization failed: ${error ?? 'missing code'}`, {
          translationKey: 'errors.authorization-failed',
        });
      }

      return code;
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;
      wrapOid4vciHttpError(e, 'Authorization request failed', {
        translationKey: 'errors.authorization-failed',
      });
    }
  }

  private async exchangeCodeForToken(params: {
    metadata: AuthorisationServerMetadata;
    authCode: string;
    redirectUri: string;
    codeVerifier: string;
    profile: IssuanceProfile;
  }): Promise<TokenResponse> {
    const tokenEndpoint = params.metadata.tokenEndpoint;
    if (!tokenEndpoint) {
      throw new Oid4vciError('Token endpoint missing in metadata', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', params.authCode);
    body.set('redirect_uri', params.redirectUri);
    body.set('code_verifier', params.codeVerifier);

    let headers = new HttpHeaders()
      .set('Content-Type', CONTENT_TYPE_URL_ENCODED_FORM);

    if (params.profile === 'haip') {
      const dpopProof = await this.dpopService.generateProof('POST', tokenEndpoint);
      headers = headers.set('DPoP', dpopProof.jwt);
    }

    try {
      const response = await firstValueFrom(
        this.http.post<TokenResponse>(tokenEndpoint, body.toString(), { headers })
      );
      return response;
    } catch (e: unknown) {
      wrapOid4vciHttpError(e, 'Token exchange failed', {
        translationKey: 'errors.cannot-get-access-token',
      });
    }
  }
}
