import { inject, Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { Router } from '@angular/router';
import { PasskeyPrfService } from './passkey-prf.service';

/**
 * Auth service for browser-only (PRF) mode.
 *
 * No backend, no JWT tokens, no email. Authentication = biometric
 * verification via the registered passkey. The passkey also provides
 * PRF-derived signing keys for credential operations.
 */
@Injectable({ providedIn: 'root' })
export class LocalAuthService {
  private readonly authenticated$ = new BehaviorSubject<boolean>(false);
  private readonly initialized$ = new BehaviorSubject<boolean>(false);
  private readonly name$ = new BehaviorSubject<string>('');

  private readonly router = inject(Router);
  private readonly prfService = inject(PasskeyPrfService);

  constructor() {
    // Initialization is synchronous — just check localStorage.
    this.initialized$.next(true);
  }

  // --- Observable interface (shared with RemoteAuthService) ---

  isLoggedIn$(): Observable<boolean> {
    return this.authenticated$.asObservable();
  }

  isInitialized$(): Observable<boolean> {
    return this.initialized$.asObservable();
  }

  isLoggedIn(): boolean {
    return this.authenticated$.getValue();
  }

  getName$(): Observable<string> {
    return this.name$.asObservable();
  }

  /** No JWT tokens in browser mode. */
  getToken(): string {
    return '';
  }

  // --- Auth flow ---

  hasPasskey(): boolean {
    return this.prfService.hasPasskey();
  }

  /**
   * First-time setup: create a discoverable passkey on this device.
   * After this, the user is authenticated.
   */
  async setupPasskey(displayName?: string): Promise<void> {
    await this.prfService.createPasskey(displayName ?? 'Wallet User');
    this.authenticated$.next(true);
    this.name$.next(displayName ?? '');
  }

  /**
   * Unlock the wallet by requesting a biometric assertion.
   * The assertion itself is not sent anywhere — it just proves user presence.
   * PRF keys will be derived on-demand when signing operations are needed.
   */
  async authenticate(): Promise<void> {
    const credentialId = this.prfService.getCredentialId();
    if (!credentialId) {
      throw new Error('No passkey registered on this device');
    }

    // Request a simple assertion to verify user presence.
    // We don't need PRF here — just biometric check.
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: Uint8Array.from(atob(credentialId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
          type: 'public-key',
        }],
        userVerification: 'required',
      },
    });

    if (!assertion) {
      throw new Error('Authentication cancelled');
    }

    this.authenticated$.next(true);
  }

  logout(): Observable<void> {
    this.authenticated$.next(false);
    this.name$.next('');
    return of(undefined);
  }

  forceLogout(): void {
    this.authenticated$.next(false);
    this.name$.next('');
    const hasPasskey = this.hasPasskey();
    this.router.navigate([hasPasskey ? '/auth/login' : '/auth/register']);
  }
}
