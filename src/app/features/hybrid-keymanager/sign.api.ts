import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SERVER_PATH } from 'src/app/core/constants/api.constants';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';

export interface PrepareSignRequest {
  credential_id: string;
  /** Full presentation payload assembled by the OID4VP engine ({iat, aud, nonce, sd_hash} for
   * KB-JWT, or the VP envelope claims for jwt_vc_json) — opaque to the EBW (architecture.md §6.2). */
  payload: Record<string, unknown>;
  format: string;
}

export interface PrepareSignResponse {
  prf_salt: string;
  wrapped_blob: string;
  iv: string;
  tag: string;
  kdf_params: string;
  signing_input: string;
  correlation_id: string;
}

export interface SubmitSignedRequest {
  credential_id: string;
  signature: string;
  correlation_id: string;
}

export interface SubmitSignedResponse {
  kb_jwt: string;
}

/**
 * HTTP client for the hybrid signing handshake endpoints on the EBW backend.
 *
 * - POST /api/v1/keys/hybrid/sign/prepare  → 200 PrepareSignResponse
 * - POST /api/v1/keys/hybrid/sign/submit   → 200 SubmitSignedResponse
 *
 * Authorization: Bearer is attached automatically by the existing auth interceptor
 * for own-backend URLs. Field names match the EBW DTOs exactly.
 *
 * Spec: EUDISTACK-536 AC-01, AC-09; technical-design.md §3.2 T11.
 */
@Injectable({ providedIn: 'root' })
export class SignApi {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  prepareSign(req: PrepareSignRequest): Promise<PrepareSignResponse> {
    return firstValueFrom(
      this.http.post<PrepareSignResponse>(
        `${this.urlResolver.serverUrl()}${SERVER_PATH.HYBRID_SIGN_PREPARE}`,
        req,
      ),
    );
  }

  submitSignedAssertion(req: SubmitSignedRequest): Promise<SubmitSignedResponse> {
    return firstValueFrom(
      this.http.post<SubmitSignedResponse>(
        `${this.urlResolver.serverUrl()}${SERVER_PATH.HYBRID_SIGN_SUBMIT}`,
        req,
      ),
    );
  }
}
