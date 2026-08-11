import { CONTENT_TYPE } from './../constants/content-type.constants';

import { HttpClient, HttpHeaders, HttpParams, HttpResponse} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {catchError, from, map, Observable, of, switchMap, tap} from 'rxjs';
import { LifeCycleStatus, VerifiableCredential } from '../models/verifiable-credential';
import { UrlResolverService } from './url-resolver.service';
import { SERVER_PATH } from '../constants/api.constants';
import { FinalizeIssuancePayload } from '../models/FinalizeIssuancePayload';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CONTENT_TYPE_APPLICATION_JSON, CONTENT_TYPE_URL_ENCODED_FORM, RESPONSE_TYPE, TEXT } from '../constants/content-type.constants';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { CredentialParserService } from '../utils/credential-parser.util';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { CredentialCacheService } from '../../shared/services/credential-cache.service';
import { VerifiableCredentialSubjectDataNormalizer } from '../models/verifiable-credential-subject-data-normalizer';
import { getExtendedCredentialType, isValidCredentialType } from '../../shared/helpers/get-credential-type.helpers';

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
  private credentialStorage = inject(LocalCredentialStorageService);
  private credentialParser = inject(CredentialParserService);
  private discovery = inject(WalletDiscoveryService);
  private urlResolver = inject(UrlResolverService);
  private credentialCache = inject(CredentialCacheService);

  /** Returns true when the wallet operates in browser (EUDIW) mode (AC-009.2c, AC-009.3c). */
  private isBrowserMode(): boolean {
    return this.discovery.mode() !== 'server';
  }

  public getVCinCBOR(credential: VerifiableCredential): Observable<string> {
    if (this.isBrowserMode()) {
      return of(credential.credentialEncoded ?? '');
    }
    const options = {
      headers: contentTypeApplicationJsonHeader,
      redirect: 'follow',
      responseType: 'text' as const,
    };
    return this.http.post(
      this.urlResolver.serverUrl() + SERVER_PATH.CBOR,
      credential,
      options
    );
  }

  public getAllVCsFromServer(): Observable<VerifiableCredential[]> {
    return this.http.get<VerifiableCredential[]>(
      this.urlResolver.serverUrl() + SERVER_PATH.CREDENTIALS,
      options
    );
  }

  public getAllVCs(): Observable<VerifiableCredential[]> {
    return from(this.credentialStorage.getAllCredentials());
  }

  /**
   * Reads the local credential store (IndexedDB), normalizes it, and pushes the
   * result into the reactive CredentialCacheService. This is the single load path
   * feeding both the credentials page and the OID4VP flow. The stream always
   * COMPLETES (even on error, via catchError) so callers can gate on it and then
   * inspect `credentialCache.status()` to tell a load error apart from an empty wallet.
   */
  public refreshCredentials(): Observable<VerifiableCredential[]> {
    this.credentialCache.setLoading();
    const normalizer = new VerifiableCredentialSubjectDataNormalizer();

    return this.getAllVCs().pipe(
      map((credentials) =>
        // newest-first, and normalize each known credentialSubject in place
        credentials.slice().reverse().map((cred) => {
          if (cred.credentialSubject && cred.type) {
            const credType = getExtendedCredentialType(cred);
            if (isValidCredentialType(credType)) {
              cred.credentialSubject = normalizer.normalizeLearCredentialSubject(cred.credentialSubject, credType);
            }
          }
          return cred;
        })
      ),
      tap((credentials) => this.credentialCache.setLoaded(credentials)),
      catchError((error: unknown) => {
        // getAllVCs() reads IndexedDB: an empty store is handled by the success
        // path above (setLoaded([])). Reaching here means a real storage failure.
        console.error('Error refreshing credentials:', error);
        this.credentialCache.setError();
        return of(this.credentialCache.getAll());
      })
    );
  }

  public syncCredentials(): Observable<void> {
    // Fetch from the server FIRST, then swap the local store atomically. We never
    // clear IndexedDB before we hold the new data, so a reader can't observe an
    // empty store mid-sync.
    return this.getAllVCsFromServer().pipe(
      switchMap((credentials) =>
        from(this.credentialStorage.replaceAllCredentials(credentials))
      ),
      switchMap(() => this.refreshCredentials()),
      map(() => void 0)
    );
  }

  public deleteVC(credentialId: string): Observable<any> {
    if (this.isBrowserMode()) {
      return from(this.credentialStorage.deleteCredential(credentialId));
    }
    return this.http.delete<string>(
      this.urlResolver.serverUrl() +
      SERVER_PATH.CREDENTIALS + '/' +
        credentialId,
      options
    ).pipe(
      switchMap(() =>
        from(this.credentialStorage.deleteCredential(credentialId))
      )
    );
  }

  public updateCredentialStatus(credentialId: string, status: LifeCycleStatus): Observable<void> {
    if (this.isBrowserMode()) {
      return from(this.credentialStorage.updateCredentialStatus(credentialId, status));
    }
    return this.http.patch<void>(
      `${this.urlResolver.serverUrl()}${SERVER_PATH.CREDENTIALS}/${credentialId}/status`,
      { status },
      options
    ).pipe(
      switchMap(() =>
        from(this.credentialStorage.updateCredentialStatus(credentialId, status)),
      )
    );
  }

  public requestSignature(credentialId: string): Observable<HttpResponse<string>> {
    if (this.isBrowserMode()) {
      // No deferred credential signing in browser mode
      return of(new HttpResponse<string>({ status: 204 }));
    }
    const options = {
      observe: 'response' as const,
    };

    return this.http.get<string>(
      `${this.urlResolver.serverUrl() + SERVER_PATH.CREDENTIALS_SIGNED_BY_ID}?credentialId=${credentialId}`,
      options
    );
  }

  public finalizeCredentialIssuance(credResponse: FinalizeIssuancePayload): Observable<void>{
    if (this.isBrowserMode()) {
      return from(this.finalizeLocally(credResponse)).pipe(
        switchMap(() => this.refreshCredentials()),
        map(() => void 0)
      );
    }
    return this.http.post<void>(
              this.urlResolver.serverUrl() + SERVER_PATH.CREDENTIAL_RESPONSE,
              { ...credResponse },
              options
    ).pipe(
      switchMap(() => this.syncCredentials())
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

    // withCredentials: this call is cross-origin (wallet.<tenant>.* -> verifier.<tenant>.*),
    // and the Verifier sets the SSO session cookie as a Set-Cookie on this response
    // (SsoSessionAuthenticationSuccessHandler). A browser only stores Set-Cookie from a
    // cross-origin XHR/fetch response when the request itself opts into credentials — without
    // this, the cookie was silently discarded and every later SSO reuse attempt saw no session
    // at all, regardless of any other fix (EUDISTACK-548 investigation). The Verifier's CORS
    // config for this endpoint already answers with Access-Control-Allow-Credentials: true.
    return this.http.post(redirectUri, body.toString(), {
      headers,
      responseType: TEXT as 'text',
      withCredentials: true,
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
