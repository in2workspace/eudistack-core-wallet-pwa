import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AuthService, isRefreshTokenRejected } from '../services/auth.service';
import { UrlResolverService } from '../services/url-resolver.service';
import { SessionExpiryMarkerService } from '../services/session-expiry-marker.service';
import { RegistrationTicketService } from '../services/registration-ticket.service';
import { WALLET_DISCOVERY_PATH } from '../constants/api.constants';

export const AUTH_RETRY_AFTER_REFRESH = new HttpContextToken<boolean>(() => false);

/** Header the Wallet Unit Service requires on the endpoints that use the session cookie (CSRF). */
export const WALLET_REQUEST_HEADER = 'X-Wallet-Request';

const AUTH_PATH = '/api/v1/auth/';

/**
 * How a request to the Wallet Unit Service's own `/api/v1/auth/*` is credentialed
 * (EUD-8 `annex/openapi.yaml`):
 *
 * - `public`: email verification — nothing.
 * - `ticket`: passkey registration, and sign-in during the email flow — the
 *   registration ticket, if any, plus the cookie (opening a session ends the one
 *   of the cookie and sets a new one). The two calls that open a session
 *   (`POST /auth/sessions`, `POST /auth/passkeys/registration`) also carry
 *   `X-Wallet-Request`, since they read the cookie.
 * - `cookie`: renewal — the cookie and `X-Wallet-Request`, no token.
 * - `session-cookie`: ending sessions — the session token, the cookie and `X-Wallet-Request`.
 * - `session`: device management (`/auth/passkeys`) and any other API — the session token.
 */
type AuthRoute = 'public' | 'ticket' | 'ticket-cookie' | 'cookie' | 'session-cookie' | 'session';

function authRouteOf(url: string): AuthRoute {
  const authPathAt = url.indexOf(AUTH_PATH);
  if (authPathAt < 0) return 'session';
  const path = url.slice(authPathAt + AUTH_PATH.length).split(/[?#]/)[0];

  if (path === 'register' || path === 'verify-email') return 'public';
  if (path === 'refresh') return 'cookie';
  if (path === 'sessions/current' || path === 'sessions/others') return 'session-cookie';
  if (path === 'sessions' || path === 'passkeys/registration') return 'ticket-cookie';
  if (path === 'sessions/options' || path === 'passkeys/registration/options') return 'ticket';
  return 'session';
}

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

  // External requests (e.g. verifier auth-response, issuer well-known)
  if (!req.url.startsWith(urlResolver.serverUrl())) {
    return next(req);
  }

  const route = authRouteOf(req.url);
  switch (route) {
    case 'public':
      return next(req);
    case 'ticket':
      return next(withTicket(req, inject(RegistrationTicketService).get()));
    case 'ticket-cookie':
      return next(withCookie(withTicket(req, inject(RegistrationTicketService).get())));
    case 'cookie':
      return next(withCookie(req));
    case 'session-cookie':
      // A rejected token is not retried: these calls end sessions, so the caller decides.
      return next(withCookie(withSessionToken(req, inject(AuthService).getToken())));
    case 'session':
      return sendWithSession(req, next);
  }
};

/**
 * Session-authenticated API call. Counts as activity (FR-19). A signed-in
 * session that let its access token expire renews it before sending. On a 401
 * the session is renewed once and the call retried; only a rejected renewal
 * (401 `invalid_session`, see `isRefreshTokenRejected`) ends the session and
 * goes to the access screen — any other renewal failure (400, 403, 5xx, 429,
 * offline) just fails this call and keeps the session.
 */
const sendWithSession: HttpInterceptorFn = (req, next) => {
  // Only inject AuthService here — all bootstrap requests have already returned above.
  // At this point APP_INITIALIZER has resolved and _snapshot is set (AD-1).
  const authService = inject(AuthService);
  const sessionExpiryMarker = inject(SessionExpiryMarkerService);
  authService.recordActivity();

  return authService.whenAccessTokenReady().pipe(
    switchMap(() => {
      const authorizedReq = withSessionToken(req, authService.getToken());
      return next(authorizedReq).pipe(
        catchError((err: HttpErrorResponse) => {
          if (err.status !== 401) {
            return throwError(() => err);
          }

          const endExpiredSession = () => {
            sessionExpiryMarker.markSessionExpired(err);
            if (authService.isLoggedIn()) {
              authService.forceLogout({ sessionExpired: true });
            }
            return throwError(() => err);
          };

          // Already signed out (e.g. the renewal before sending was rejected): nothing to renew.
          if (req.context.get(AUTH_RETRY_AFTER_REFRESH) || !authService.isLoggedIn()) {
            return endExpiredSession();
          }

          return authService.refreshAccessToken().pipe(
            catchError(refreshErr => isRefreshTokenRejected(refreshErr) ? endExpiredSession() : throwError(() => err)),
            switchMap(() => {
              const retryReq = withSessionToken(authorizedReq, authService.getToken()).clone({
                context: authorizedReq.context.set(AUTH_RETRY_AFTER_REFRESH, true),
              });
              return next(retryReq).pipe(
                catchError((retryErr: HttpErrorResponse) =>
                  retryErr.status === 401 ? endExpiredSession() : throwError(() => retryErr))
              );
            })
          );
        })
      );
    })
  );
};

function withSessionToken<T>(req: HttpRequest<T>, token: string): HttpRequest<T> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

function withTicket<T>(req: HttpRequest<T>, ticket: string | null): HttpRequest<T> {
  const credentialed = req.clone({ withCredentials: true });
  return ticket ? credentialed.clone({ setHeaders: { Authorization: `Bearer ${ticket}` } }) : credentialed;
}

function withCookie<T>(req: HttpRequest<T>): HttpRequest<T> {
  return req.clone({ withCredentials: true, setHeaders: { [WALLET_REQUEST_HEADER]: '1' } });
}
