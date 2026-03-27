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
import { environment } from 'src/environments/environment';
import { Oid4vciFlowStateService } from './oid4vci-flow-state.service';

@Injectable({ providedIn: 'root' })
export class AuthorizationCodeTokenService {
  private readonly http = inject(HttpClient);
  private readonly pkceService = inject(PkceService);
  private readonly dpopService = inject(DpopService);
  private readonly wiaService = inject(WiaService);
  private readonly flowStateService = inject(Oid4vciFlowStateService);

  /**
   * Initiates the authorization_code flow. For HAIP, sends the PAR request first.
   * Then redirects the browser to the authorization endpoint.
   *
   * This method NEVER returns — it navigates the browser away.
   * The flow resumes in the callback page after the issuer redirects back.
   */
  async initiateAuthorizationFlow(
    credentialOfferUri: string,
    credentialOffer: CredentialOffer,
    metadata: AuthorisationServerMetadata,
    profile: IssuanceProfile
  ): Promise<never> {
    this.dpopService.reset();
    this.wiaService.reset();

    const codeVerifier = this.pkceService.issueCodeVerifier();
    const codeChallenge = await this.pkceService.issueCodeChallenge(codeVerifier);

    const issuerState = credentialOffer.grant?.authorizationCodeGrant?.issuerState;
    const scope = credentialOffer.credentialConfigurationsIds?.[0] ?? '';
    const redirectUri = environment.oid4vci_redirect_uri;
    const state = globalThis.crypto.randomUUID();

    let requestUri: string | undefined;

    if (profile === 'haip') {
      requestUri = await this.performPar({
        metadata, codeChallenge, scope, redirectUri, state, issuerState,
      });
    }

    // Persist state before navigating away
    this.flowStateService.save({
      credentialOfferUri,
      codeVerifier,
      state,
      redirectUri,
      profile,
    });

    // Build authorize URL and redirect the browser
    this.redirectToAuthorize({
      metadata,
      requestUri,
      codeChallenge: profile !== 'haip' ? codeChallenge : undefined,
      scope: profile !== 'haip' ? scope : undefined,
      redirectUri: profile !== 'haip' ? redirectUri : undefined,
      state,
      issuerState: profile !== 'haip' ? issuerState : undefined,
    });

    // This never resolves — browser navigates away
    return new Promise<never>(() => {});
  }

  /**
   * Completes the authorization_code flow after the browser returns from the issuer.
   * Called from the callback page with the authorization code.
   */
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

    this.dpopService.reset();

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

  private async performPar(params: {
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

    try {
      const parResponse = await firstValueFrom(
        this.http.post<{ request_uri: string; expires_in: number }>(
          parEndpoint, parBody.toString(), { headers: parHeaders }
        )
      );
      return parResponse.request_uri;
    } catch (e: unknown) {
      wrapOid4vciHttpError(e, 'PAR request failed', {
        translationKey: 'errors.par-failed',
      });
    }
  }

  private redirectToAuthorize(params: {
    metadata: AuthorisationServerMetadata;
    requestUri?: string;
    codeChallenge?: string;
    scope?: string;
    redirectUri?: string;
    state: string;
    issuerState?: string;
  }): void {
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

    window.location.href = `${authEndpoint}?${queryParams.toString()}`;
  }
}
