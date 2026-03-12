import { inject, Injectable } from '@angular/core';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { HttpClient, HttpHeaders, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialResponseWithStatus } from '../../models/CredentialResponseWithStatus';
import { CredentialRequest } from '../../models/CredentialRequest';
import { CredentialResponse } from '../../models/dto/CredentialResponse';
import { JWT_VC_JSON, DC_SD_JWT } from 'src/app/core/constants/jwt.constants';
import { WalletService } from 'src/app/core/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';

@Injectable({ providedIn: 'root' })
export class CredentialService {
  private readonly http = inject(HttpClient);
  private readonly walletService = inject(WalletService);

  public async getCredential(params: {
    jwtProof: string | null;
    tokenResponse: TokenResponse;
    credentialIssuerMetadata: CredentialIssuerMetadata;
    format: string;
    credentialConfigurationId: string;
    dpopJwt?: string;
  }): Promise<CredentialResponseWithStatus> {

    const request = this.createCredentialRequest({
      jwtProof: params.jwtProof,
      format: params.format,
      credentialConfigurationId: params.credentialConfigurationId,
    });

    const accessToken = params.tokenResponse.access_token;
    const endpoint = params.credentialIssuerMetadata.credentialEndpoint;

    if (accessToken === undefined || endpoint === undefined) {
      const baseMsg = `Missing access token (${accessToken}) or credential endpoint (${endpoint})`;
      throw new Oid4vciError(baseMsg, {
        translationKey: 'errors.cannot-get-VC',
      });
    }

    return await this.postCredentialRequest({
      accessToken,
      endpoint,
      body: request,
      tokenType: params.tokenResponse.token_type,
      dpopJwt: params.dpopJwt,
    });
  }

  private createCredentialRequest(params: {
    jwtProof: string | null;
    format: string;
    credentialConfigurationId: string;
  }): CredentialRequest {
    if (!params.credentialConfigurationId) {
      throw new Oid4vciError('Credential configuration id not provided', {
        translationKey: 'errors.invalid-credential-configuration',
      });
    }

    const SUPPORTED_FORMATS = [JWT_VC_JSON, DC_SD_JWT];
    if (!SUPPORTED_FORMATS.includes(params.format)) {
      throw new Oid4vciError(`Format not supported: ${params.format}`, {
        translationKey: 'errors.unsupported-credential-format',
      });
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
    tokenType?: string;
    dpopJwt?: string;
  }): Promise<CredentialResponseWithStatus> {

    let response: HttpResponse<CredentialResponse>;

    const isDpop = params.tokenType?.toLowerCase() === 'dpop' && params.dpopJwt;

    try {
      if (isDpop) {
        let headers = new HttpHeaders()
          .set('Content-Type', 'application/json')
          .set('Accept', 'application/json')
          .set('Authorization', `DPoP ${params.accessToken}`)
          .set('DPoP', params.dpopJwt!);

        response = await firstValueFrom(
          this.http.post<CredentialResponse>(params.endpoint, params.body, { headers, observe: 'response' })
        );
      } else {
        response = await firstValueFrom(
          this.walletService.postFromUrlAndObserveResponse(params.endpoint, params.body as {}, params.accessToken)
        );
      }
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;

      wrapOid4vciHttpError(e, 'Credential request failed', {
        translationKey: 'errors.cannot-get-VC',
      });
    }

    const status = response.status;

    if (status !== 200 && status !== 202) {
      throw new Oid4vciError(`Unexpected HTTP status: ${status}`, {
        translationKey: 'errors.cannot-get-VC',
      });
    }

    if (!response.body) {
      throw new Oid4vciError('Empty credential response body', {
        translationKey: 'errors.cannot-get-VC',
      });
    }

    return {
      credentialResponse: response.body,
      status,
    };
  }
}