import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { JwtService } from '../oid4vci/jwt.service';
import { VerifierValidationService } from './verifier-validation.service';
import { AuthorizationRequestOID4VP, DcqlQuery } from './authorization-request.model';

@Injectable({
  providedIn: 'root'
})
export class AuthorizationRequestService {

  private readonly http = inject(HttpClient);
  private readonly jwtService = inject(JwtService);
  private readonly verifierValidationService = inject(VerifierValidationService);

  async processAuthorizationRequestFromQr(qrContent: string): Promise<AuthorizationRequestOID4VP> {
    const params = this.extractQueryParams(qrContent);
    const jwt = await this.fetchJwtFromParams(params);
    await this.verifierValidationService.verifyAuthorizationRequest(jwt);
    return this.parseAuthorizationRequest(jwt);
  }

  private extractQueryParams(qrContent: string): Map<string, string> {
    // Handle both openid4vp:// and https:// schemes
    let urlString = qrContent;
    if (urlString.startsWith('openid4vp://')) {
      urlString = urlString.replace('openid4vp://', 'https://openid4vp/');
    }

    const url = new URL(urlString);
    const params = new Map<string, string>();
    url.searchParams.forEach((value, key) => {
      params.set(key, value);
    });
    return params;
  }

  private async fetchJwtFromParams(params: Map<string, string>): Promise<string> {
    const requestUri = params.get('request_uri');
    const requestInline = params.get('request');

    if (requestUri) {
      return firstValueFrom(
        this.http.get(requestUri, { responseType: 'text' })
      );
    }

    if (requestInline) {
      return requestInline;
    }

    throw new Error("Expected 'request' or 'request_uri' in authorization request parameters");
  }

  private parseAuthorizationRequest(jwt: string): AuthorizationRequestOID4VP {
    const payload = this.jwtService.parseJwtPayload(jwt) as Record<string, unknown>;

    const scopeRaw = payload['scope'];
    let scope: string[] | undefined;
    if (typeof scopeRaw === 'string') {
      scope = scopeRaw.split(' ');
    } else if (Array.isArray(scopeRaw)) {
      scope = scopeRaw as string[];
    }

    let dcqlQuery: DcqlQuery | undefined;
    if (payload['dcql_query']) {
      dcqlQuery = payload['dcql_query'] as DcqlQuery;
    }

    return {
      scope,
      responseType: (payload['response_type'] as string) ?? 'vp_token',
      responseMode: (payload['response_mode'] as string) ?? 'direct_post',
      clientId: payload['client_id'] as string,
      clientIdScheme: payload['client_id_scheme'] as string | undefined,
      state: payload['state'] as string,
      nonce: payload['nonce'] as string,
      responseUri: (payload['response_uri'] ?? payload['redirect_uri']) as string,
      dcqlQuery,
    };
  }
}
