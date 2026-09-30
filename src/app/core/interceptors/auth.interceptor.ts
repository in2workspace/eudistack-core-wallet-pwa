import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';
import { UrlResolverService } from '../services/url-resolver.service';
import { SessionExpiryMarkerService } from '../services/session-expiry-marker.service';
import { WALLET_DISCOVERY_PATH } from '../constants/api.constants';

export const AUTH_RETRY_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // --- Early exits: never need a token, and must NOT trigger inject(AuthService)
  // because APP_INITIALIZER runs these requests before WalletDiscoveryService
  // resolves its snapshot (AUTH_SERVICE_PROVIDER factory timing, EUDISTACK-502).
  const urlResolver = inject(UrlResolverService);

  // Public well-known endpoint (EUDISTACK-412)
  if (req.url.endsWith(WALLET_DISCOVERY_PATH)) {
    return next(req);
  }

  // Static assets — never authenticated; also fired by ThemeService during bootstrap
  if (req.url.startsWith('/assets/') || req.url.includes('/assets/tenants/')) {
    return next(req);
  }

  // Auth endpoints handle their own credentials (except passkey management)
  const isAuthEndpoint = req.url.includes('/api/v1/auth/');
  const isPasskeyEndpoint = req.url.includes('/api/v1/auth/passkeys');
  if (isAuthEndpoint && !isPasskeyEndpoint) {
    return next(req);
  }

  // External requests (e.g. verifier auth-response, issuer well-known)
  const serverUrl = urlResolver.serverUrl();
  const isOwnBackend = req.url.startsWith(serverUrl);
  if (!isOwnBackend) {
    return next(req);
  }

  // Only inject AuthService here — all bootstrap requests have already returned above.
  // At this point APP_INITIALIZER has resolved and _snapshot is set (AD-1).
  const authService = inject(AuthService);
  const sessionExpiryMarker = inject(SessionExpiryMarkerService);
  const token = authService.getToken();

  const authorizedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authorizedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) {
        return throwError(() => err);
      }

      // A failed refresh already ended the session itself, keeping the refresh token
      // when the failure was transient so the device can resume with its passkey.
      // Forcing a logout here would drop that token regardless, hence the guard.
      const endExpiredSession = (keepRefreshToken: boolean) => {
        sessionExpiryMarker.markSessionExpired(err);
        if (authService.isLoggedIn()) {
          authService.forceLogout({ keepRefreshToken });
        }
        return throwError(() => err);
      };

      if (req.context.get(AUTH_RETRY_AFTER_REFRESH)) {
        return endExpiredSession(true);
      }

      return authService.refreshAccessToken().pipe(
        catchError(() => endExpiredSession(false)),
        switchMap(() => {
          const newToken = authService.getToken();
          const retryReq = authorizedReq.clone({
            setHeaders: newToken ? { Authorization: `Bearer ${newToken}` } : {},
            context: authorizedReq.context.set(AUTH_RETRY_AFTER_REFRESH, true),
          });
          // The refresh just succeeded, so the device refresh token is still valid:
          // dropping it would force email + OTP on a session the passkey can resume.
          return next(retryReq).pipe(catchError(() => endExpiredSession(true)));
        })
      );
    })
  );
};
