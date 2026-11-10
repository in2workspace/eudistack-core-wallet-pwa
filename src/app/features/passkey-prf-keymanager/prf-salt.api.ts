import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { SERVER_PATH } from 'src/app/core/constants/api.constants';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';

export interface PrfSaltDto {
  credential_id: string;
  /** Base64url of 32 random bytes: input of the PRF extension. */
  prf_salt: string;
  kdf: { algorithm: string; info: string };
  /** Only when the attestation is already stored. */
  public_jwk?: JsonWebKey;
}

/**
 * Salt and public key of the attestations obtained with passkey custody.
 *
 * The Wallet Unit Service only gives them to a session opened with the passkey the attestation
 * belongs to; for any other it answers 404, like for an attestation that does not exist.
 */
@Injectable({ providedIn: 'root' })
export class PrfSaltApi {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  /** Creates the salt of a new attestation, bound to the passkey of the session. */
  create(credentialId: string): Promise<PrfSaltDto> {
    const url = `${this.urlResolver.serverUrl()}${SERVER_PATH.PASSKEY_PRF_SALTS}`;
    return firstValueFrom(this.http.post<PrfSaltDto>(url, { credential_id: credentialId }));
  }

  /** Gets the salt and the public key of a stored attestation. */
  get(credentialId: string): Promise<PrfSaltDto> {
    const url = `${this.urlResolver.serverUrl()}${SERVER_PATH.PASSKEY_PRF_SALT(credentialId)}`;
    return firstValueFrom(this.http.get<PrfSaltDto>(url));
  }
}
