import { inject, Injectable } from '@angular/core';
import { base64UrlEncode, base64UrlDecode } from '../utils/base64url';
import { deriveP256KeyFromBytes } from '../utils/p256-key-derivation.util';
import { AppError } from '../models/error/AppError';
import { PasskeyError, runPasskeyCeremony } from '../models/error/PasskeyError';
import { PasskeyStoreService } from './passkey-store.service';
import { WEBAUTHN_CREATE_HINTS, WEBAUTHN_ASSERTION_HINTS } from '../constants/webauthn.constants';

const HKDF_INFO = 'eudistack:p256:v1';
const MASTER_SALT = new TextEncoder().encode('eudistack:master:v1');
const ASSERTION_TIMEOUT_MS = 60_000;
const CREATION_TIMEOUT_MS = 120_000;

export type PrfSupportStatus = 'available' | 'unavailable';

/**
 * Low-level service for WebAuthn PRF extension operations.
 *
 * Manages a single discoverable passkey per origin and uses the PRF
 * extension to derive deterministic P-256 signing keys from a salt.
 *
 * Private keys are never stored — they exist only in memory during signing.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyPrfService {
  private status: PrfSupportStatus | null = null;
  private prfLock: Promise<any> | null = null;
  private readonly store = inject(PasskeyStoreService);

  /** Check whether the current browser + authenticator support PRF. */
  async init(): Promise<PrfSupportStatus> {
    if (this.status) return this.status;
    this.status = await this.detectPrfSupport();
    return this.status;
  }

  /** Whether a passkey credential ID is stored locally. */
  hasPasskey(): boolean {
    return !!this.store.getCredentialId();
  }

  /** Returns the stored passkey credential ID, or null. */
  getCredentialId(): string | null {
    return this.store.getCredentialId();
  }

  /**
   * Local WebAuthn assertion of the device passkey (no PRF, no server).
   * Browser mode only (`LoginPage.authenticateLocally`): in server mode the
   * Wallet Unit Service issues and verifies every challenge (EUD-8).
   */
  async assertLocalPasskey(): Promise<void> {
    const credentialId = this.getCredentialId();
    if (!credentialId) {
      throw new PasskeyError('passkey_not_found', 'get');
    }

    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32)).buffer as ArrayBuffer;
    const credentialIdBuffer = base64UrlDecode(credentialId).buffer as ArrayBuffer;
    await runPasskeyCeremony('get', ASSERTION_TIMEOUT_MS, () => navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id: credentialIdBuffer,
          type: 'public-key',
        }],
        userVerification: 'required',
        timeout: ASSERTION_TIMEOUT_MS,
        // @ts-expect-error — `hints` not yet in this TS lib's PublicKeyCredentialRequestOptions (WebAuthn L3)
        hints: WEBAUTHN_ASSERTION_HINTS,
      },
    }));
  }

  /**
   * Create a new discoverable passkey (client-side only, no backend).
   * The challenge is generated locally — the attestation is not verified.
   * Returns the base64url-encoded credential ID.
   *
   * `accountKey` scopes the reused WebAuthn user handle to one account (defaults
   * to `displayName`, which is the account email in server mode). A retry by the
   * same account reuses its handle; a different account gets a fresh one so the
   * authenticator never overwrites the first account's resident credential.
   */
  async createPasskey(displayName: string, accountKey: string = displayName): Promise<string> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));

    let userIdB64 = this.store.getWebAuthnUserId(accountKey);
    if (!userIdB64) {
      userIdB64 = base64UrlEncode(globalThis.crypto.getRandomValues(new Uint8Array(16)));
      await this.store.setWebAuthnUserId(accountKey, userIdB64);
    }
    const userId = base64UrlDecode(userIdB64);

    const options: PublicKeyCredentialCreationOptions = {
      rp: { name: document.title || 'EUDI Wallet' },
      user: {
        id: userId,
        name: displayName || 'wallet-user',
        displayName: displayName || 'Wallet User',
      },
      challenge,
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },   // ES256
        { alg: -257, type: 'public-key' },  // RS256 fallback
      ],
      authenticatorSelection: {
        residentKey: 'required',
        userVerification: 'required',
      },
      extensions: {
        // @ts-ignore — PRF extension not yet in TS lib types
        prf: {},
      } as AuthenticationExtensionsClientInputs,
      timeout: CREATION_TIMEOUT_MS,
      // @ts-expect-error — `hints` not yet in this TS lib's PublicKeyCredentialCreationOptions (WebAuthn L3)
      hints: WEBAUTHN_CREATE_HINTS,
    };

    const credential = (await runPasskeyCeremony('create', CREATION_TIMEOUT_MS, () => navigator.credentials.create({
      publicKey: options,
    }))) as PublicKeyCredential;

    const credentialId = base64UrlEncode(new Uint8Array(credential.rawId));
    await this.store.setCredentialId(credentialId);

    return credentialId;
  }

  /** Derive a P-256 signing key from the passkey PRF output. Always requires a biometric prompt. */
  async deriveSigningKey(salt: Uint8Array): Promise<{
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
  }> {
    // Serialize concurrent callers — only one biometric prompt at a time.
    while (this.prfLock) {
      await this.prfLock;
    }

    const credentialIdB64 = this.store.getCredentialId();
    if (!credentialIdB64) {
      throw new PasskeyError('passkey_not_found', 'get');
    }

    const credentialIdBytes = base64UrlDecode(credentialIdB64);

    let resolve!: () => void;
    this.prfLock = new Promise<void>(r => { resolve = r; });

    try {
      const master = await this.evaluatePrf(credentialIdBytes, MASTER_SALT);
      return deriveP256KeyFromBytes(master, salt, HKDF_INFO);
    } finally {
      this.prfLock = null;
      resolve();
    }
  }

  /** Remove the stored passkey credential ID. */
  async clearPasskey(): Promise<void> {
    await this.store.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async evaluatePrf(
    credentialId: Uint8Array,
    salt: Uint8Array
  ): Promise<Uint8Array> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));

    // No `timeout` here: the browser default applies, so a timeout cannot be told apart from a cancel.
    const assertion = (await runPasskeyCeremony('get', undefined, () => navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId.slice(), type: 'public-key' }],
        userVerification: 'required',
        extensions: {
          // @ts-ignore — PRF extension not yet in TS lib types
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
        // @ts-expect-error — `hints` not yet in this TS lib's PublicKeyCredentialRequestOptions (WebAuthn L3)
        hints: WEBAUTHN_ASSERTION_HINTS,
      },
    }))) as PublicKeyCredential;

    const extensions = assertion.getClientExtensionResults() as any;
    const prfResults = extensions?.prf?.results;

    if (!prfResults?.first) {
      throw new AppError(
        'PRF extension not supported by this authenticator',
        { translationKey: 'auth.errors.passkey-not-supported' }
      );
    }

    return new Uint8Array(prfResults.first);
  }

  private async detectPrfSupport(): Promise<PrfSupportStatus> {
    if (
      !globalThis.PublicKeyCredential ||
      !globalThis.crypto?.subtle ||
      !navigator.credentials
    ) {
      return 'unavailable';
    }

    try {
      // Heuristic: if PublicKeyCredential exists and we have a secure context,
      // assume PRF *might* be available. Definitive check happens at first use.
      const isSecure =
        globalThis.isSecureContext ??
        (location.protocol === 'https:' ||
         ['localhost', '127.0.0.1'].includes(location.hostname));

      return isSecure ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}
