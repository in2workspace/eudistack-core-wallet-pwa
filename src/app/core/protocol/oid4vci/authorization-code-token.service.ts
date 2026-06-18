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

    const codeVerifier = this.pkceService.issueCodeVerifier();
    const codeChallenge = await this.pkceService.issueCodeChallenge(codeVerifier);

    const issuerState = credentialOffer.grant?.authorizationCodeGrant?.issuerState;
    const scope = credentialOffer.credentialConfigurationsIds?.[0] ?? '';
    const redirectUri = environment.oid4vci_redirect_uri;
    const state = globalThis.crypto.randomUUID();

    let authCode: string;

    if (profile === 'haip') {
      authCode = await this.performHaipFlow({
        metadata, codeChallenge, scope, redirectUri, state, issuerState,
      });
    } else {
      authCode = await this.performPlainFlow({
        metadata, codeChallenge, scope, redirectUri, state, issuerState,
      });
    }

    return await this.exchangeCodeForToken({
      metadata, authCode, redirectUri, codeVerifier, profile,
    });
  }

  private async performHaipFlow(params: {
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

  private async performPlainFlow(params: {
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

  // For same-origin deployments (issuer and wallet share domain), the authorize endpoint
  // redirects immediately back to the callback with ?code=&state=. Angular's HttpClient
  // follows the redirect and response.url contains the code — no browser navigation needed.
  //
  // For cross-origin deployments (e.g. DOME with separate domains), Chrome blocks the XHR
  // redirect chain because the issuer's 302 response lacks CORS headers. In that case we
  // fall back to a hidden iframe: browser navigation is not subject to CORS restrictions,
  // so the iframe follows the redirect silently and the callback page relays the code back
  // via postMessage without any visible UI change.
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

    // Primary path: programmatic HTTP request (same-origin deployments).
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

      // CORS failure on the XHR redirect: fall back to hidden iframe.
      return this.callAuthorizeEndpointViaIframe(authorizeUrl, params.state);
    }
  }

  // Hidden-iframe fallback for cross-origin deployments where the issuer's 302 redirect
  // lacks CORS headers. The iframe performs browser navigation (no CORS restriction),
  // lands on the same-origin /wallet/callback?code=&state=, and ProtocolCallbackPage
  // relays the code back via postMessage.
  private callAuthorizeEndpointViaIframe(authorizeUrl: string, state: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'display:none;position:absolute;width:0;height:0;border:0;';
      document.body.appendChild(iframe);

      const cleanup = () => {
        clearTimeout(timeoutId);
        window.removeEventListener('message', messageHandler);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      };

      const messageHandler = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (!event.data || event.data.type !== 'oid4vci-auth-code') return;
        cleanup();
        if (event.data.state !== state) {
          reject(new Oid4vciError('OAuth state mismatch in authorization callback', {
            translationKey: 'errors.authorization-failed',
          }));
          return;
        }
        const code = event.data.code;
        if (!code) {
          reject(new Oid4vciError(`Authorization failed: ${event.data.error ?? 'missing code'}`, {
            translationKey: 'errors.authorization-failed',
          }));
          return;
        }
        resolve(code);
      };

      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Oid4vciError('Authorization request timed out', {
          translationKey: 'errors.authorization-failed',
        }));
      }, 30_000);

      window.addEventListener('message', messageHandler);
      iframe.src = authorizeUrl;
    });
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
}