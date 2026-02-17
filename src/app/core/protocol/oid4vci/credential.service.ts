import { CONTENT_TYPE_APPLICATION_JSON } from 'src/app/constants/content-type.constants';
import { inject, Injectable } from '@angular/core';
import { TokenResponse } from '../../models/TokenResponse';
import { CredentialIssuerMetadata } from '../../models/CredentialIssuerMetadata';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpResponse } from '@angular/common/http';
import { firstValueFrom, tap } from 'rxjs';

export interface CredentialResponseWithStatus {
  credentialResponse: CredentialResponse;
  status: number;
}

export interface CredentialResponseWithStatusCode {
  credentialResponse: CredentialResponse;
  statusCode: number;
}

export interface CredentialResponse {
  // todo
  credentials?: { credential: string }[];
  transaction_id?: string;
  c_nonce?: string;
  c_nonce_expires_in?: number; 
}
  
  
  export interface CredentialRequest {
    format: string;
    credential_configuration_id: string;
    proof?: { proof_type: string; jwt: string; }; 
  } 
  
@Injectable({ providedIn: 'root' })
export class CredentialService {
  
  private readonly http = inject(HttpClient);

  public async getCredential(params: {
    jwtProof: string | null;
    tokenResponse: TokenResponse;
    credentialIssuerMetadata: CredentialIssuerMetadata;
    format: string;
    credentialConfigurationId: string;
  }): Promise<CredentialResponseWithStatus> {
    console.log("Getting credential with params:", params);

    const request = this.buildCredentialRequest({
      jwtProof: params.jwtProof,
      format: params.format,
      credentialConfigurationId: params.credentialConfigurationId,
    });
    console.log("Built credential request:", request);

    const accessToken = params.tokenResponse.access_token;
    const endpoint = params.credentialIssuerMetadata.credentialEndpoint;

    if(accessToken === undefined || endpoint === undefined){
      throw new Error('Missing access token or credential endpoint');
    }

    return await this.postCredentialRequest({
      accessToken: accessToken,
      endpoint: endpoint,
      body: request,
    });
  }

  // todo: call nonce_endpoint when supported
  public getNonceValue(): string | null {
    return null;
  }

  private buildCredentialRequest(params: {
    jwtProof: string | null;
    format: string;
    credentialConfigurationId: string;
  }): CredentialRequest {
    if (!params.credentialConfigurationId) {
      throw new Error('Credentials configurations ids not provided');
    }

    // todo make constant
    const JWT_VC_JSON = 'jwt_vc_json';

    if (params.format !== JWT_VC_JSON) {
      throw new Error(`Format not supported: ${params.format}`);
    }

    const request: CredentialRequest = {
      format: params.format,
      credential_configuration_id: params.credentialConfigurationId,
    };

    if (params.jwtProof && params.jwtProof.trim().length > 0) {
      request.proof = {
        proof_type: 'jwt',
        jwt: params.jwtProof,
      };
    }

    return request;
  }

  private async postCredentialRequest(params: {
    accessToken: string;
    endpoint: string;
    body: unknown;
  }): Promise<CredentialResponseWithStatus> {
    console.log("Posting credential request with params:", params);
    //todo maybe reusable
    const headers = new HttpHeaders({
      Authorization: `Bearer ${params.accessToken}`,
      CONTENT_TYPE: CONTENT_TYPE_APPLICATION_JSON,
    });

    let response: HttpResponse<CredentialResponse>;

    try {
      response = await firstValueFrom(
        this.http.post<CredentialResponse>(params.endpoint, params.body, {
          headers,
          observe: 'response',
        }).pipe(tap(resp=> console.log("Received credential response:", resp)))
      );
    } catch (e) {
      if (e instanceof HttpErrorResponse) {
        throw new Error(`Credential request failed (${e.status}): ${this.safeErrBody(e.error)}`);
      }
      throw e;
    }

    const status = response.status;

    if (status !== 200 && status !== 202) {
      throw new Error(`Unexpected HTTP status: ${status}`);
    }
    if (!response.body) {
      throw new Error('Empty credential response body');
    }

    return {
      credentialResponse: response.body,
      status,
    };
  }

  //todo reusable
  private safeErrBody(err: unknown): string {
    try {
      if (typeof err === 'string') return err;
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }
}
