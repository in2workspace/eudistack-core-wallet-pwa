import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * Coordinates `authInterceptor` and `HttpErrorInterceptor`, which independently
 * catch the same failed request on the way back up the interceptor chain.
 * Without this, an expired-session 401 was handled twice: authInterceptor
 * redirected to /auth/login, then HttpErrorInterceptor — unaware the 401 was
 * already dealt with — fell through to its generic branch and showed
 * "Something went wrong" on top of the redirect.
 *
 * A WeakSet keyed by the HttpErrorResponse instance avoids leaking references
 * once the response is no longer reachable from the interceptor chain.
 */
@Injectable({ providedIn: 'root' })
export class SessionExpiryMarkerService {
  private readonly marked = new WeakSet<HttpErrorResponse>();

  markSessionExpired(err: HttpErrorResponse): void {
    this.marked.add(err);
  }

  isSessionExpired(err: HttpErrorResponse): boolean {
    return this.marked.has(err);
  }
}
