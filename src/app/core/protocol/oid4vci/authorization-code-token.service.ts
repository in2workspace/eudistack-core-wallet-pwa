import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { IssuanceProfile } from './issuance-profile.util';
import { PkceService } from './pkce.service';
import { DpopService } from './dpop.service';
import { WiaService } from './wia.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';
import { CONTENT_TYPE_URL_ENCODED_FORM } from 'src/app/core/constants/content-type.constants';
import { environment } from 'src/environments/environment';
import { AuthCodeFlowStateService } from './auth-code-flow-state.service';

@Injectable({ providedIn: 'root' })
export class AuthorizationCodeTokenService {
  private readonly http = inject(HttpClient);
  private readonly pkceService = inject(PkceService);
  private readonly dpopService = inject(DpopService);
  private readonly wiaService = inject(WiaService);
  private readonly authCodeFlowStateService = inject(AuthCodeFlowStateService);

  // Initiates the Authorization Code Flow by navigating the browser to the authorize endpoint.
  // This method never resolves — the browser navigates away. The flow resumes in the callback
  // via Oid4vciEngineService.resumeAuthCodeFlow() which calls exchangeCodeForToken() directly.
  async getToken(
    credentialOffer: CredentialOffer,
    metadata: AuthorisationServerMetadata,
    profile: IssuanceProfile,
    credentialIssuerMetadata: CredentialIssuerMetadata,
  ): Promise<TokenResponse> {
    this.dpopService.reset();
    this.wiaService.reset();

    const codeVerifier = this.pkceService.issueCodeVerifier();
    const codeChallenge = await this.pkceService.issueCodeChallenge(codeVerifier);

    const issuerState = credentialOffer.grant?.authorizationCodeGrant?.issuerState;
    const scope = credentialOffer.credentialConfigurationsIds?.[0] ?? '';
    const redirectUri = environment.oid4vci_redirect_uri;
    const oauthState = globalThis.crypto.randomUUID();

    this.authCodeFlowStateService.save({
      credentialOffer,
      credentialIssuerMetadata,
      authServerMetadata: metadata,
      profile,
      codeVerifier,
      redirectUri,
      oauthState,
    });

    if (profile === 'haip') {
      await this.performHaipAuthorize({
        metadata, codeChallenge, scope, redirectUri, state: oauthState, issuerState,
      });
    } else {
      await this.performPlainAuthorize({
        metadata, codeChallenge, scope, redirectUri, state: oauthState, issuerState,
      });
    }

    return new Promise<never>(() => {});
  }

  async exchangeCodeForToken(params: {
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
      const dpopProof = await this.dpopService.issueProof('POST', tokenEndpoint);
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

  private async performHaipAuthorize(params: {
    metadata: AuthorisationServerMetadata;
    codeChallenge: string;
    scope: string;
    redirectUri: string;
    state: string;
    issuerState?: string;
  }): Promise<void> {
    const parEndpoint = params.metadata.pushedAuthorizationRequestEndpoint;
    if (!parEndpoint) {
      throw new Oid4vciError('PAR endpoint missing in metadata (required for HAIP)', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const dpopProof = await this.dpopService.issueProof('POST', parEndpoint);
    const attestation = await this.wiaService.fetchAttestationHeaders(params.metadata.issuer ?? parEndpoint);

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

    await this.callAuthorizeEndpoint({
      metadata: params.metadata,
      requestUri: requestUri!,
      state: params.state,
    });
  }

  private async performPlainAuthorize(params: {
    metadata: AuthorisationServerMetadata;
    codeChallenge: string;
    scope: string;
    redirectUri: string;
    state: string;
    issuerState?: string;
  }): Promise<void> {
    await this.callAuthorizeEndpoint({
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
  }): Promise<void> {
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

    globalThis.location.href = `${authEndpoint}?${queryParams.toString()}`;
    return new Promise<never>(() => {});
  }
}