import { inject, Injectable } from '@angular/core';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialResponseWithStatus } from '../../models/CredentialResponseWithStatus';
import { CredentialRequest } from '../../models/CredentialRequest';
import { CredentialResponse } from '../../models/dto/CredentialResponse';
import { JWT_VC_JSON } from 'src/app/core/constants/jwt.constants';
import { WalletService } from 'src/app/core/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';

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

    const request = this.buildCredentialRequest({
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
    });
  }

  private buildCredentialRequest(params: {
    jwtProof: string | null;
    format: string;
    credentialConfigurationId: string;
  }): CredentialRequest {
    if (!params.credentialConfigurationId) {
      throw new Oid4vciError('Credential configuration id not provided', {
        translationKey: 'errors.invalid-credential-configuration',
      });
    }

    if (params.format !== JWT_VC_JSON) {
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
  }): Promise<CredentialResponseWithStatus> {

    let response: HttpResponse<CredentialResponse>;

    try {
      response = await firstValueFrom(
        this.walletService.postFromUrlAndObserveResponse(params.endpoint, params.body as {}, params.accessToken)
      );
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