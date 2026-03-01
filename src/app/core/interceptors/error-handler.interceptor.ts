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
import { SERVER_PATH } from '../constants/api.constants';
import { environment } from 'src/environments/environment';
import { AuthService } from '../services/auth.service';

@Injectable()
export class HttpErrorInterceptor implements HttpInterceptor {
  private readonly toastServiceHandler = inject(ToastServiceHandler);
  private readonly authService = inject(AuthService);

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
        // Normalize URL to ensure request params are not included in the conditionals below
        const urlObj = new URL(request.url);
        const href = urlObj.href;
        const isOwnBackend = href.startsWith(environment.server_url);
        const pathname = urlObj.pathname;

        let errMessage =
          errorResp.error?.message || errorResp.message || 'Unknown Http error';
        const errStatus = errorResp.status ?? errorResp.error?.status;

        // Handle 401 Unauthorized — force logout
        if (errStatus === 401 && !pathname.startsWith('/api/v1/auth/')) {
          this.authService.forceLogout();
          return throwError(() => errorResp);
        }

        if (!isOwnBackend) {
          // Do not toast for 3rd party endpoints (issuers, well-known, etc.)
          this.logHandledSilentlyErrorMsg(errMessage);
          return throwError(() => errorResp);
        }

        // DON'T SHOW POPUP CASES
        const shouldHandleSilently =
          // get credentials endpoint
          (pathname.endsWith(SERVER_PATH.CREDENTIALS) &&
            errMessage?.startsWith('The credentials list is empty')) ||
          // OID4VCI finalize endpoint
          urlObj.href.endsWith(SERVER_PATH.CREDENTIAL_RESPONSE) ||
          // REQUEST SIGNATURE endpoint
          pathname.endsWith(SERVER_PATH.CREDENTIALS_SIGNED_BY_ID) ||
          // Auth endpoints
          pathname.startsWith('/api/v1/auth/');

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