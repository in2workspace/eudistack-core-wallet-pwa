import { Injectable, inject } from '@angular/core';
import {
  HttpInterceptor,
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { SERVER_PATH, WALLET_DISCOVERY_PATH } from '../constants/api.constants';
import { UrlResolverService } from '../services/url-resolver.service';
import { SessionExpiryMarkerService } from '../services/session-expiry-marker.service';

@Injectable()
export class HttpErrorInterceptor implements HttpInterceptor {
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly urlResolver = inject(UrlResolverService);
  private readonly sessionExpiryMarker = inject(SessionExpiryMarkerService);

  private logHandledSilentlyErrorMsg(errMsg: string) {
    console.error('Handled silently:', errMsg);
  }

  public intercept(
    request: HttpRequest<unknown>,
    next: HttpHandler
  ): Observable<HttpEvent<unknown>> {
    //todo refactor this handler (conditional structure)

    return next.handle(request).pipe(
      catchError((errorResp: HttpErrorResponse) => {
        // authInterceptor already forced a logout for this exact 401 (expired/invalid
        // session). Show the dedicated message once here instead of falling through
        // to the generic branch below, which would duplicate it with an unrelated
        // "Something went wrong" toast (previously: same 401 handled twice by two
        // uncoordinated interceptors).
        if (this.sessionExpiryMarker.isSessionExpired(errorResp)) {
          this.toastServiceHandler.showErrorAlertByTranslateLabel('errors.session-expired').subscribe();
          return throwError(() => errorResp);
        }

        // Normalize URL to ensure request params are not included in the conditionals below
        const urlObj = new URL(request.url, window.location.origin);
        const href = urlObj.href;
        const isOwnBackend = href.startsWith(this.urlResolver.serverUrl());
        const pathname = urlObj.pathname;

        let errMessage =
          errorResp.error?.message || errorResp.message || 'Unknown Http error';
        const errStatus = errorResp.status ?? errorResp.error?.status;

        if (!isOwnBackend) {
          // Do not toast for 3rd party endpoints (issuers, well-known, etc.)
          this.logHandledSilentlyErrorMsg(errMessage);
          return throwError(() => errorResp);
        }

        // DON'T SHOW POPUP CASES
        const shouldHandleSilently =
          // static assets (theme.json, i18n, etc.) — not real backend errors
          pathname.startsWith('/assets/') ||
          // well-known wallet discovery endpoint — silent fallback by design (AD-2)
          pathname.endsWith(WALLET_DISCOVERY_PATH) ||
          // get credentials endpoint
          (pathname.endsWith(SERVER_PATH.CREDENTIALS) &&
            errMessage?.startsWith('The credentials list is empty')) ||
          // OID4VCI finalize endpoint
          urlObj.href.endsWith(SERVER_PATH.CREDENTIAL_RESPONSE) ||
          // REQUEST SIGNATURE endpoint
          pathname.endsWith(SERVER_PATH.CREDENTIALS_SIGNED_BY_ID) ||
          // Auth endpoints
          pathname.startsWith('/api/v1/auth/') ||
          // Hybrid signing endpoints — never toast or expose body (NFR-S-536-03 defense-in-depth)
          pathname.endsWith(SERVER_PATH.HYBRID_SIGN_PREPARE) ||
          pathname.endsWith(SERVER_PATH.HYBRID_SIGN_SUBMIT);

        if (shouldHandleSilently) {
          this.logHandledSilentlyErrorMsg(errMessage);
          return throwError(() => errorResp);
        }

        // SHOW POPUP CASES
        // same-device credential offer request
        // todo keep this only while we keep the old activation flow
        if (pathname.endsWith(SERVER_PATH.REQUEST_CREDENTIAL)) {
          if (errMessage.startsWith('Incorrect PIN')) {
            // simply don't change the message, the one from backend is ok
          } else if (errStatus === 504 || errStatus === 408) {
            // 504 for nginx Gateway timeout, 408 for backend
            errMessage = 'PIN expired';
          }
        }

        this.toastServiceHandler.showErrorAlert(errMessage).subscribe();
        console.error('Error occurred:', errorResp);

        return throwError(() => errorResp);
      })
    );
  }
}
