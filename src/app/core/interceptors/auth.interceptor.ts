import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';
import { environment } from 'src/environments/environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

  // Don't add auth header to auth endpoints (they handle their own auth)
  if (req.url.includes('/api/v1/auth/')) {
    return next(req);
  }

  // Don't add auth header to external requests (e.g. verifier auth-response).
  // When server_url is empty (nginx proxy mode), own-origin requests use
  // relative paths, so any absolute URL is external.
  const serverUrl = environment.server_url;
  const isOwnBackend = serverUrl
    ? req.url.startsWith(serverUrl)
    : req.url.startsWith('/');
  if (!isOwnBackend) {
    return next(req);
  }

  const token = authService.getToken();
  if (token) {
    const clonedReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(clonedReq);
  }

  return next(req);
};
