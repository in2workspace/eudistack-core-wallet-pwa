import { Injectable } from '@angular/core';

/**
 * Holds the registration ticket that `POST /auth/verify-email` returns, in memory
 * only (never in localStorage, sessionStorage or IndexedDB). It lets the access
 * screen register a passkey or sign in with one of the account's passkeys; it
 * never opens a session by itself (FR-16).
 *
 * The auth interceptor sends it as `Authorization: Bearer` to the passkey
 * registration and session endpoints while the email flow is in progress.
 */
@Injectable({ providedIn: 'root' })
export class RegistrationTicketService {
  private ticket: string | null = null;
  private expiresAt = 0;

  set(ticket: string, expiresInSeconds: number): void {
    this.ticket = ticket;
    this.expiresAt = Date.now() + expiresInSeconds * 1000;
  }

  /** The ticket while it is still within its validity; the service decides whether it is still usable. */
  get(): string | null {
    if (this.ticket && Date.now() >= this.expiresAt) {
      this.clear();
    }
    return this.ticket;
  }

  clear(): void {
    this.ticket = null;
    this.expiresAt = 0;
  }
}
