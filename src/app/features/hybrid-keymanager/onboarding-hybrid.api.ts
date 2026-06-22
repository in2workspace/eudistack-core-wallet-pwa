import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from 'src/environments/environment';

const BASE_PATH = '/api/v1/keys/hybrid/onboarding';

export interface InitRequest {
  credential_id: string;
  format: string;
}

export interface InitResponse {
  prf_salt: string;
  kdf_params: string;
  signing_pubkey_envelope_format: string;
}

export interface CommitRequest {
  credential_id: string;
  wrapped_blob: string;
  iv: string;
  tag: string;
  kdf_algo: string;
  kdf_version: number;
  cnf_jwk: string;
}

export interface CommitResponse {
  credential_id: string;
}

export interface BlockRequest {
  credential_id: string;
  correlation_id: string;
}

export interface BlockResponse {
  credential_id: string;
}

/**
 * HTTP client for the hybrid onboarding endpoints on the EBW backend.
 *
 * - POST /api/v1/keys/hybrid/onboarding/init  → 200 with prf_salt + kdf_params
 * - POST /api/v1/keys/hybrid/onboarding/commit → 201 (new) or 200 (idempotent replay)
 *
 * Spec: EUDISTACK-534 AC-01, AC-04, AC-07; technical-design.md §3.2 T15.
 */
@Injectable({ providedIn: 'root' })
export class OnboardingHybridApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.server_url;

  init(req: InitRequest): Promise<InitResponse> {
    return firstValueFrom(
      this.http.post<InitResponse>(`${this.baseUrl}${BASE_PATH}/init`, req),
    );
  }

  commit(req: CommitRequest): Promise<CommitResponse> {
    return firstValueFrom(
      this.http.post<CommitResponse>(`${this.baseUrl}${BASE_PATH}/commit`, req),
    );
  }

  block(req: BlockRequest): Promise<BlockResponse> {
    return firstValueFrom(
      this.http.post<BlockResponse>(`${this.baseUrl}${BASE_PATH}/block`, req),
    )
  }
}
