import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UrlResolverService } from './url-resolver.service';

export interface PasskeyInfo {
  id: string;
  credentialId: string;
  displayName: string;
  createdAt: string;
  lastUsedAt: string | null;
  activeSessions: number;
}

/**
 * Service to manage the account's passkeys via the backend API (session token).
 * Only used in server mode (wallet_mode === 'server'). Registering a passkey is
 * a WebAuthn ceremony verified by the service: see PasskeyCeremonyService (EUD-8).
 *
 * Implements US-006 to US-010 from EUDI-044:
 * - US-006: List passkeys
 * - US-007: Delete passkey
 * - US-008: Rename passkey
 * - US-009: Revoke sessions
 */
@Injectable({ providedIn: 'root' })
export class PasskeyApiService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  /**
   * List all passkeys for the current user.
   * US-006: GET /api/auth/passkeys
   */
  listPasskeys(): Observable<PasskeyInfo[]> {
    return this.http.get<PasskeyInfo[]>(`${this.authBase}/passkeys`);
  }

  /**
   * Rename a passkey.
   * US-008: PATCH /api/auth/passkeys/{id}
   */
  renamePasskey(id: string, displayName: string): Observable<PasskeyInfo> {
    return this.http.patch<PasskeyInfo>(`${this.authBase}/passkeys/${id}`, { displayName });
  }

  /**
   * Delete a passkey. Will fail if it's the last one.
   * US-007: DELETE /api/auth/passkeys/{id}
   */
  deletePasskey(id: string): Observable<void> {
    return this.http.delete<void>(`${this.authBase}/passkeys/${id}`);
  }

  /**
   * Revoke all sessions for a specific passkey without deleting it.
   * US-009: POST /api/auth/passkeys/{id}/revoke-sessions
   */
  revokeSessions(id: string): Observable<void> {
    return this.http.post<void>(`${this.authBase}/passkeys/${id}/revoke-sessions`, {});
  }
}

