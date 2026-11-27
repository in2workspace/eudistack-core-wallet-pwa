import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UrlResolverService } from './url-resolver.service';

/** A passkey of the account, as `GET /auth/passkeys` returns it: identifiers and dates, no device data. */
export interface PasskeyInfo {
  id: string;
  credentialId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The passkeys of the account (server mode), read for the Signal API and to find the WebAuthn credential of the
 * session's passkey. The passkeys API does not manage devices (EUD-15 AD-4): devices are the Wallet Instances
 * (`WalletInstanceService`). Registering a passkey is a WebAuthn ceremony verified by the service: see
 * `PasskeyCeremonyService` (EUD-8).
 */
@Injectable({ providedIn: 'root' })
export class PasskeyApiService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  /** `GET /auth/passkeys`. */
  listPasskeys(): Observable<PasskeyInfo[]> {
    return this.http.get<PasskeyInfo[]>(`${this.authBase}/passkeys`);
  }
}
