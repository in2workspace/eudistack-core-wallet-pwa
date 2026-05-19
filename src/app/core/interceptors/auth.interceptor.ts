import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { WALLET_DISCOVERY_PATH } from '../constants/api.constants';
import { environment } from 'src/environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  // --- Early exits: never need a token, and must NOT trigger inject(AuthService)
  // because APP_INITIALIZER runs these requests before WalletDiscoveryService
  // resolves its snapshot (AUTH_SERVICE_PROVIDER factory timing, EUDISTACK-502).

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
  // In nginx proxy mode server_url is empty, so any relative path is own-backend.
  const serverUrl = environment.server_url;
  const isOwnBackend = serverUrl
    ? req.url.startsWith(serverUrl)
    : req.url.startsWith('/');
  if (!isOwnBackend) {
    return next(req);
  }

  // Only inject AuthService here — all bootstrap requests have already returned above.
  // At this point APP_INITIALIZER has resolved and _snapshot is set (AD-1).
  const token = inject(AuthService).getToken();
  if (token) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }

  return next(req);
};
