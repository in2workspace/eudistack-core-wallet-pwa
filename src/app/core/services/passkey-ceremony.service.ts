import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { PasskeyError, runPasskeyCeremony } from '../models/error/PasskeyError';
import { AUTH_PROBLEM_TYPE, authProblemType, WalletAuthError } from '../models/error/WalletAuthError';
import { base64UrlDecode } from '../utils/base64url';
import { UrlResolverService } from './url-resolver.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { WebAuthnBrowserService } from './webauthn-browser.service';

/** Key manager of the tenants with passkey custody: the passkey's PRF protects the holder keys. */
export const PASSKEY_CUSTODY_KEY_MANAGER = 'passkey-prf';

/** Timeout of the one-off PRF check, the same as any other passkey use. */
const PRF_CHECK_TIMEOUT_MS = 60_000;
const PRF_CHECK_SALT_BYTES = 32;

/**
 * A PRF check rejected faster than this was not answered by the user: Safari
 * refuses a second WebAuthn call that is not started by a new user gesture.
 */
const GESTURE_LOSS_MAX_MS = 1_500;

/**
 * The PRF check of a just-created passkey could not start without a new tap.
 * `resume()` must be called from a click handler: it runs the check and, if it
 * passes, registers the passkey.
 */
export class PrfCheckNeedsGestureError extends Error {
  public constructor(public readonly resume: () => Promise<PasskeySession>) {
    super('The PRF check needs a new user gesture');
  }
}

/** `Session` of the contract: returned when a passkey ceremony or a renewal succeeds. */
export interface SessionResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  passkeyId: string;
}

interface CeremonyOptions<T> {
  ceremonyId: string;
  publicKey: T;
}

/** A session opened with a verified passkey, with what the Signal API needs about it. */
export interface PasskeySession {
  session: SessionResponse;
  rpId: string;
  /** User handle (base64url) of the account. */
  userId: string | null;
  /** WebAuthn credential ID (base64url) of the passkey. */
  credentialId: string;
}

/**
 * WebAuthn ceremonies against the Wallet Unit Service (EUD-8, design §2.4):
 * the service issues the challenge and verifies the result, the browser runs
 * the ceremony with `@simplewebauthn/browser` and the options as received
 * (rp, user handle, timeouts, hints and extensions are the service's).
 *
 * The registration ticket and the cookie travel through the auth interceptor.
 * No PRF output is ever sent to the service.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyCeremonyService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly webAuthnBrowser = inject(WebAuthnBrowserService);

  private get authBase(): string { return `${this.urlResolver.serverUrl()}/api/v1/auth`; }

  /**
   * Sign-in with a passkey (FR-12, FR-13). Without a registration ticket the
   * service sends an empty `allowCredentials`, so the system shows its account
   * picker; with one, it lists the passkeys of the ticket's account (FR-09).
   */
  async signIn(): Promise<PasskeySession> {
    const { ceremonyId, publicKey } = await this.requestOptions<PublicKeyCredentialRequestOptionsJSON>('sessions/options');
    const credential = await runPasskeyCeremony<AuthenticationResponseJSON>(
      'get', publicKey.timeout, () => startAuthentication({ optionsJSON: publicKey })
    );
    const rpId = publicKey.rpId ?? globalThis.location.hostname;

    try {
      const session = await firstValueFrom(this.http.post<SessionResponse>(`${this.authBase}/sessions`, {
        ceremonyId,
        credential: withoutPrfOutputs(credential),
      }));
      return { session, rpId, userId: credential.response.userHandle ?? null, credentialId: credential.id };
    } catch (err) {
      throw await this.toSignInError(err, rpId, credential.id);
    }
  }

  /**
   * Registration of a new passkey for the ticket's account (FR-07, FR-08). With
   * passkey custody, a passkey whose PRF cannot be confirmed is not registered
   * and the passkey manager is asked to hide it.
   */
  async register(displayName?: string): Promise<PasskeySession> {
    const { ceremonyId, publicKey } =
      await this.requestOptions<PublicKeyCredentialCreationOptionsJSON>('passkeys/registration/options');
    const credential = await runPasskeyCeremony<RegistrationResponseJSON>(
      'create', publicKey.timeout, () => startRegistration({ optionsJSON: publicKey })
    );
    return this.registerCreated(ceremonyId, publicKey, credential, displayName?.trim(), true);
  }

  /**
   * Checks the PRF of a created passkey and registers it. `allowGestureRetry`:
   * a check rejected almost at once (Safari drops the user gesture after the
   * creation dialog) does not count as a cancel; the caller gets a
   * `PrfCheckNeedsGestureError` to run the check again from a new tap.
   */
  private async registerCreated(
    ceremonyId: string,
    publicKey: PublicKeyCredentialCreationOptionsJSON,
    credential: RegistrationResponseJSON,
    name: string | undefined,
    allowGestureRetry: boolean,
  ): Promise<PasskeySession> {
    const rpId = publicKey.rp.id ?? globalThis.location.hostname;
    const prfSupported = await this.confirmPrf(credential, rpId, allowGestureRetry
      ? () => this.registerCreated(ceremonyId, publicKey, credential, name, false)
      : null);

    try {
      const session = await firstValueFrom(this.http.post<SessionResponse>(`${this.authBase}/passkeys/registration`, {
        ceremonyId,
        credential: withoutPrfOutputs(credential),
        prfSupported,
        ...(name ? { displayName: name } : {}),
      }));
      return { session, rpId, userId: publicKey.user.id, credentialId: credential.id };
    } catch (err) {
      throw await this.toRegistrationError(err, rpId, credential.id);
    }
  }

  /** True when the tenant keeps the holder keys under the passkey's PRF (passkey custody). */
  hasPasskeyCustody(): boolean {
    return this.discovery.snapshot()()?.keyManager === PASSKEY_CUSTODY_KEY_MANAGER;
  }

  private async requestOptions<T>(path: string): Promise<CeremonyOptions<T>> {
    try {
      return await firstValueFrom(this.http.post<CeremonyOptions<T>>(`${this.authBase}/${path}`, {}));
    } catch (err) {
      if (authProblemType(err) === AUTH_PROBLEM_TYPE.INVALID_TICKET) {
        throw new WalletAuthError('invalid_ticket', err);
      }
      throw err;
    }
  }

  /**
   * `prfSupported` of the registration (design §2.4). Without passkey custody it
   * just reports `prf.enabled`. With it, a creation that does not confirm the PRF
   * is followed by one use of the new passkey with a random local salt: some
   * managers only give the PRF on use (Windows Hello in Chrome/Edge ≤ 146,
   * Samsung Pass). The PRF output is only checked for presence and discarded.
   */
  private async confirmPrf(
    credential: RegistrationResponseJSON,
    rpId: string,
    retryWithGesture: (() => Promise<PasskeySession>) | null,
  ): Promise<boolean> {
    const enabledAtCreation = credential.clientExtensionResults?.prf?.enabled === true;
    if (enabledAtCreation || !this.hasPasskeyCustody()) {
      return enabledAtCreation;
    }

    let prfConfirmed: boolean;
    const startedAt = Date.now();
    try {
      prfConfirmed = await this.evaluatePrfOnce(credential.rawId, rpId);
    } catch (err) {
      const gestureLost = err instanceof PasskeyError && err.code === 'passkey_cancelled'
        && Date.now() - startedAt < GESTURE_LOSS_MAX_MS;
      if (gestureLost && retryWithGesture) {
        throw new PrfCheckNeedsGestureError(retryWithGesture);
      }
      // The passkey will not be registered: hide it from the passkey manager.
      await this.webAuthnBrowser.signalUnknownCredential(rpId, credential.id);
      if (err instanceof PasskeyError && err.isUserAbort) {
        throw err;
      }
      throw new WalletAuthError('passkey_prf_unsupported', err);
    }

    if (!prfConfirmed) {
      await this.webAuthnBrowser.signalUnknownCredential(rpId, credential.id);
      throw new WalletAuthError('passkey_prf_unsupported');
    }
    return true;
  }

  private async evaluatePrfOnce(rawId: string, rpId: string): Promise<boolean> {
    const assertion = await runPasskeyCeremony('get', PRF_CHECK_TIMEOUT_MS, () => navigator.credentials.get({
      publicKey: {
        // Local check, never sent to the service: a random challenge is enough.
        challenge: globalThis.crypto.getRandomValues(new Uint8Array(32)),
        rpId,
        allowCredentials: [{ type: 'public-key', id: base64UrlDecode(rawId) }],
        userVerification: 'required',
        timeout: PRF_CHECK_TIMEOUT_MS,
        extensions: {
          prf: { eval: { first: globalThis.crypto.getRandomValues(new Uint8Array(PRF_CHECK_SALT_BYTES)) } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential;

    const results = assertion.getClientExtensionResults() as { prf?: { results?: { first?: BufferSource } } };
    const first = results.prf?.results?.first;
    if (!first) {
      return false;
    }
    zeroize(first);
    return true;
  }

  private async toSignInError(err: unknown, rpId: string, credentialId: string): Promise<unknown> {
    switch (authProblemType(err)) {
      case AUTH_PROBLEM_TYPE.UNKNOWN_CREDENTIAL:
        await this.webAuthnBrowser.signalUnknownCredential(rpId, credentialId);
        return new WalletAuthError('unknown_credential', err);
      case AUTH_PROBLEM_TYPE.AUTHENTICATION_FAILED:
        return new WalletAuthError('authentication_failed', err);
      case AUTH_PROBLEM_TYPE.INVALID_TICKET:
        return new WalletAuthError('invalid_ticket', err);
      default:
        return err;
    }
  }

  private async toRegistrationError(err: unknown, rpId: string, credentialId: string): Promise<unknown> {
    switch (authProblemType(err)) {
      case AUTH_PROBLEM_TYPE.PASSKEY_PRF_UNSUPPORTED:
        await this.webAuthnBrowser.signalUnknownCredential(rpId, credentialId);
        return new WalletAuthError('passkey_prf_unsupported', err);
      case AUTH_PROBLEM_TYPE.REGISTRATION_FAILED:
        // Not signalled: the passkey may already be registered in the tenant and still be valid.
        return new WalletAuthError('registration_failed', err);
      case AUTH_PROBLEM_TYPE.INVALID_TICKET:
        return new WalletAuthError('invalid_ticket', err);
      default:
        return err;
    }
  }
}

/** Keeps `prf.enabled`, the only PRF value the contract reads, and drops any PRF output. */
function withoutPrfOutputs<T extends { clientExtensionResults: AuthenticationExtensionsClientOutputs }>(credential: T): T {
  const { prf, ...otherResults } = credential.clientExtensionResults as AuthenticationExtensionsClientOutputs & {
    prf?: { enabled?: boolean };
  };
  const clientExtensionResults = prf?.enabled === undefined
    ? otherResults
    : { ...otherResults, prf: { enabled: prf.enabled } };
  return { ...credential, clientExtensionResults };
}

function zeroize(buffer: BufferSource): void {
  const bytes = ArrayBuffer.isView(buffer)
    ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    : new Uint8Array(buffer);
  bytes.fill(0);
}
