import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PasskeyError } from '../models/error/PasskeyError';
import { PasskeyApiService } from './passkey-api.service';

/**
 * The passkey that opened the current server session (FR-15), in memory only.
 *
 * `passkeyId` is the service's identifier (`Session.passkeyId`). The WebAuthn
 * credential ID is known right after a ceremony; after resuming a session with
 * the refresh cookie it is looked up in `GET /auth/passkeys`. Passkey custody
 * uses it to evaluate the PRF with the same passkey the session is bound to,
 * since the service only returns the attestations bound to that passkey.
 */
@Injectable({ providedIn: 'root' })
export class SessionPasskeyService {
  private readonly passkeyApi = inject(PasskeyApiService);

  private readonly _passkeyId = signal<string | null>(null);
  private credentialId: string | null = null;

  readonly passkeyId = this._passkeyId.asReadonly();

  /** Records the passkey of a session. A different passkey drops the credential ID of the previous one. */
  set(passkeyId: string, credentialId: string | null = null): void {
    if (passkeyId !== this._passkeyId()) {
      this.credentialId = null;
    }
    this._passkeyId.set(passkeyId);
    if (credentialId) {
      this.credentialId = credentialId;
    }
  }

  clear(): void {
    this._passkeyId.set(null);
    this.credentialId = null;
  }

  /** WebAuthn credential ID (base64url) of the session's passkey. */
  async resolveCredentialId(): Promise<string> {
    if (this.credentialId) {
      return this.credentialId;
    }
    const passkeyId = this._passkeyId();
    if (!passkeyId) {
      throw new PasskeyError('passkey_not_found', 'get');
    }
    const passkeys = await firstValueFrom(this.passkeyApi.listPasskeys());
    const sessionPasskey = passkeys.find(passkey => passkey.id === passkeyId);
    if (!sessionPasskey || this._passkeyId() !== passkeyId) {
      throw new PasskeyError('passkey_not_found', 'get');
    }
    this.credentialId = sessionPasskey.credentialId;
    return sessionPasskey.credentialId;
  }
}
