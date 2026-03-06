import { CONTENT_TYPE } from './../constants/content-type.constants';

import { HttpClient, HttpHeaders, HttpParams, HttpResponse} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { environment } from 'src/environments/environment';
import { VerifiableCredential } from '../models/verifiable-credential';
import { SERVER_PATH } from '../constants/api.constants';
import { FinalizeIssuancePayload } from '../models/FinalizeIssuancePayload';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CONTENT_TYPE_APPLICATION_JSON, CONTENT_TYPE_URL_ENCODED_FORM, RESPONSE_TYPE, TEXT } from '../constants/content-type.constants';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { CredentialParserService } from '../utils/credential-parser.util';

const contentTypeApplicationJsonHeader = new HttpHeaders({
  [CONTENT_TYPE]: CONTENT_TYPE_APPLICATION_JSON,
});

export const options = {
  headers: contentTypeApplicationJsonHeader,
  redirect: 'follow',
};

const isBrowserMode = () => (environment as any).wallet_mode !== 'server';

@Injectable({
  providedIn: 'root',
})
export class WalletService {
  private http = inject(HttpClient);
  private credentialStorage = inject(LocalCredentialStorageService);
  private credentialParser = inject(CredentialParserService);

  public getVCinCBOR(credential: VerifiableCredential): Observable<string> {
    if (isBrowserMode()) {
      return of(credential.credentialEncoded ?? '');
    }
    const options = {
      headers: contentTypeApplicationJsonHeader,
      redirect: 'follow',
      responseType: 'text' as const,
    };
    return this.http.post(
      environment.server_url + SERVER_PATH.CBOR,
      credential,
      options
    );
  }

  public getAllVCs(): Observable<VerifiableCredential[]> {
    if (isBrowserMode()) {
      return from(this.credentialStorage.getAllCredentials());
    }
    return this.http.get<VerifiableCredential[]>(
      environment.server_url + SERVER_PATH.CREDENTIALS,
      options
    );
  }

  public deleteVC(credentialId: string): Observable<any> {
    if (isBrowserMode()) {
      return from(this.credentialStorage.deleteCredential(credentialId));
    }
    return this.http.delete<string>(
      environment.server_url +
      SERVER_PATH.CREDENTIALS + '/' +
        credentialId,
      options
    );
  }

  public requestSignature(credentialId: string): Observable<HttpResponse<string>> {
    if (isBrowserMode()) {
      // No deferred credential signing in browser mode
      return of(new HttpResponse<string>({ status: 204 }));
    }
    const options = {
      observe: 'response' as const,
    };

    return this.http.get<string>(
      `${environment.server_url + SERVER_PATH.CREDENTIALS_SIGNED_BY_ID}?credentialId=${credentialId}`,
      options
    );
  }

  public finalizeCredentialIssuance(credResponse: FinalizeIssuancePayload): Observable<void>{
    if (isBrowserMode()) {
      return from(this.finalizeLocally(credResponse));
    }
    return this.http.post<void>(
              environment.server_url + SERVER_PATH.CREDENTIAL_RESPONSE,
              { ...credResponse },
              options
            );
  }

  // --- Generic HTTP helpers (used by protocol services for external calls) ---

  public fetchTextFromUrl(url: string): Observable<string>{
    return this.http.get(url, { headers: contentTypeApplicationJsonHeader, [RESPONSE_TYPE]: TEXT });
  }

  public postFromUrlForTextResponse(url: string, body: {}): Observable<string>{
    return this.http.post(url, body, {
              headers: { [CONTENT_TYPE]: CONTENT_TYPE_URL_ENCODED_FORM },
              responseType: TEXT
            })
  }

  public postFromUrlAndObserveResponse(url: string, body: {}, accessToken: string): Observable<HttpResponse<CredentialResponse>>{
    const headers = new HttpHeaders()
    .set(CONTENT_TYPE, 'application/json')
    .set('Accept', 'application/json')
    .set('Authorization', `Bearer ${accessToken}`);

    return this.http.post<CredentialResponse>(url, body, { headers, observe: 'response' });
  }

  public postOid4vpAuthorizationResponse(
    redirectUri: string,
    state: string,
    vpToken: string
  ): Observable<string> {
    const body = new HttpParams()
      .set('state', state)
      .set('vp_token', vpToken);

    const headers = new HttpHeaders({
      [CONTENT_TYPE]: CONTENT_TYPE_URL_ENCODED_FORM,
    });

    return this.http.post(redirectUri, body.toString(), {
      headers,
      responseType: TEXT as 'text',
    });
  }

  // --- Private: browser-mode credential finalization ---

  private async finalizeLocally(payload: FinalizeIssuancePayload): Promise<void> {
    const vc = this.credentialParser.parseCredentialResponse(
      payload.credentialResponseWithStatus.credentialResponse,
      payload.format
    );
    await this.credentialStorage.saveCredential(vc);
  }

}
