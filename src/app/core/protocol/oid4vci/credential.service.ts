import { inject, Injectable } from '@angular/core';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { HttpErrorResponse, HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialResponseWithStatus } from '../../models/CredentialResponseWithStatus';
import { CredentialRequest } from '../../models/CredentialRequest';
import { CredentialResponse } from '../../models/dto/CredentialResponse';
import { JWT_VC_JSON } from 'src/app/constants/jwt.constants';
import { WalletService } from 'src/app/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { retryUserMessage, wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';

  
@Injectable({ providedIn: 'root' })
export class CredentialService {
  
  private readonly walletService = inject(WalletService);

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
      const baseMsg = 'Missing access token (' + accessToken + ') or credential endpoint (' + endpoint + ')';
      throw new Oid4vciError(baseMsg, {
        userMessage: retryUserMessage('Could not request the credential'),
      });
    }

    return await this.postCredentialRequest({
      accessToken: accessToken,
      endpoint: endpoint,
      body: request,
    });
  }

  private buildCredentialRequest(params: {
    jwtProof: string | null;
    format: string;
    credentialConfigurationId: string;
  }): CredentialRequest {
    if (!params.credentialConfigurationId) {
            const baseMsg = 'Credential configuration id not provided';
      throw new Oid4vciError(baseMsg, {
        userMessage: retryUserMessage('Invalid credential configuration'),
      });
    }

    if (params.format !== JWT_VC_JSON) {
        const baseMsg = `Format not supported: ${params.format}`;
        throw new Oid4vciError(baseMsg, {
        userMessage: retryUserMessage('Unsupported credential format'),
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
  }): Promise<CredentialResponseWithStatus> {
    console.log("Posting credential request with params:", params);

    let response: HttpResponse<CredentialResponse>;

    try {
      response = await firstValueFrom(
        this.walletService.postFromUrlAndObserveResponse(params.endpoint, params.body as {}, params.accessToken)
      );
    } catch (e) {
      const baseMsg = 'Credential request failed';
      const userMsg = retryUserMessage('Could not request the credential');

      if (e instanceof Oid4vciError) throw e;

      if (e instanceof HttpErrorResponse) {
        wrapOid4vciHttpError(e, baseMsg, { userMessage: userMsg });
      }
      throw new Oid4vciError(baseMsg, {
        cause: e,
        userMessage: retryUserMessage(userMsg),
      });
    }

    const status = response.status;

    if (status !== 200 && status !== 202) {
      const baseMsg = `Unexpected HTTP status: ${status}`;
      throw new Oid4vciError(baseMsg, {
        userMessage: retryUserMessage('Could not request the credential'),
      });
    }

    if (!response.body) {
      const baseMsg = 'Empty credential response body';
      throw new Oid4vciError(baseMsg, {
        userMessage: retryUserMessage('Could not request the credential'),
      });
    }

    return {
      credentialResponse: response.body,
      status,
    };
  }

}
