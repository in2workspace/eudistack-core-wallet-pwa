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

export interface RegisterPasskeyRequest {
  credentialId: string;
  displayName: string;
  userAgent?: string;
}

/**
 * Service to manage passkeys via the backend API.
 * Only used in server mode (wallet_mode === 'server').
 *
 * Implements US-005 to US-010 from EUDI-044:
 * - US-005: Register passkey metadata
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
   * Register a new passkey on the server after local WebAuthn creation.
   * US-005: POST /api/auth/passkeys
   */
  registerPasskey(request: RegisterPasskeyRequest): Observable<PasskeyInfo> {
    return this.http.post<PasskeyInfo>(`${this.authBase}/passkeys`, request);
  }

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

