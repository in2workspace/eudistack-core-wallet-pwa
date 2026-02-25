import { CONTENT_TYPE } from './../constants/content-type.constants';

import { HttpClient, HttpHeaders, HttpParams, HttpResponse} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { VerifiableCredential } from '../interfaces/verifiable-credential';
import { VCReply } from '../interfaces/verifiable-credential-reply';
import { SERVER_PATH } from '../constants/api.constants';
import { FinalizeIssuancePayload } from '../core/models/FinalizeIssuancePayload';
import { CredentialResponse } from '../core/models/dto/CredentialResponse';
import { CONTENT_TYPE_APPLICATION_JSON, CONTENT_TYPE_URL_ENCODED_FORM, RESPONSE_TYPE, TEXT } from '../constants/content-type.constants';

const contentTypeApplicationJsonHeader = new HttpHeaders({
  [CONTENT_TYPE]: CONTENT_TYPE_APPLICATION_JSON,
});

export const options = {
  headers: contentTypeApplicationJsonHeader,
  redirect: 'follow',
};
@Injectable({
  providedIn: 'root',
})
export class WalletService {
  private http = inject(HttpClient);

  //this sends the URL contained by the QR, which can be a verifiable presentation URl or either a Credential offer URL (cross device)
  public executeContent(url: string): Observable<JSON> {
    return this.http.post<JSON>(
      environment.server_url + SERVER_PATH.EXECUTE_CONTENT,
      { qr_content: url },
      options
    );
  }
  
  public getVCinCBOR(credential: VerifiableCredential): Observable<string> {
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

  public requestOpenidCredentialOffer(credentialOfferUri: string): Observable<JSON> {
    const params = new HttpParams().set('credentialOfferUri', credentialOfferUri);
    return this.http.get<JSON>(
      environment.server_url + SERVER_PATH.REQUEST_CREDENTIAL,
      {
        params,
        headers: options.headers
      }
    );
  }

  // Request all Verifiable Credentials of a user from the Wallet Data
  public getAllVCs(): Observable<VerifiableCredential[]> {
    return this.http.get<VerifiableCredential[]>(
      environment.server_url + SERVER_PATH.CREDENTIALS,
      options
    );
  }

  // Request one Verifiable Credential of a user from the Wallet Data
  public getOne(data: string) {
    return this.http.get<VerifiableCredential>(
      environment.server_url + '/api/vc/1/' + data + '/format?format=vc_json',
      options
    );
  }

  // Delete the selected Verifiable Credential from the Wallet Data
  public deleteVC(credentialId: string) {
    return this.http.delete<string>(
      environment.server_url +
      SERVER_PATH.CREDENTIALS + '/' +
        credentialId,
      options
    );
  }
  
  public requestSignature(credentialId: string): Observable<HttpResponse<string>> {
    const options = {
      observe: 'response' as const,
    };

    return this.http.get<string>(
      `${environment.server_url + SERVER_PATH.CREDENTIALS_SIGNED_BY_ID}?credentialId=${credentialId}`,
      options
    );
  }

  public finalizeCredentialIssuance(credResponse: FinalizeIssuancePayload): Observable<void>{
    return this.http.post<void>(
              environment.server_url + SERVER_PATH.CREDENTIAL_RESPONSE,
              { ...credResponse },
              options
            );
  }


  public getTextFromUrl(url: string): Observable<string>{
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

}
