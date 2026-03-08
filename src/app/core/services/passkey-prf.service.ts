import { inject, Injectable } from '@angular/core';
import { base64UrlEncode, base64UrlDecode } from '../utils/base64url';
import { AppError } from '../models/error/AppError';
import { p256 } from '@noble/curves/nist.js';
import { PasskeyStoreService } from './passkey-store.service';

const HKDF_INFO = 'eudistack:p256:v1';

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
   * Attempt to recover a previously registered discoverable passkey
   * when the credential ID has been lost from localStorage.
   *
   * Uses navigator.credentials.get() without allowCredentials, which
   * prompts the user to select a discoverable credential for this origin.
   * If found, the credential ID is re-persisted to localStorage.
   *
   * Returns the recovered credential ID, or null if no passkey was found.
   */
  async tryRecoverPasskey(): Promise<string | null> {
    if (this.hasPasskey()) {
      return this.getCredentialId();
    }

    try {
      const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          userVerification: 'required',
          // No allowCredentials → discoverable credential prompt
        },
      })) as PublicKeyCredential | null;

      if (!assertion) return null;

      const credentialId = base64UrlEncode(new Uint8Array(assertion.rawId));
      await this.store.setCredentialId(credentialId);

      return credentialId;
    } catch {
      return null;
    }
  }

  /**
   * Create a new discoverable passkey (client-side only, no backend).
   * The challenge is generated locally — the attestation is not verified.
   * Returns the base64url-encoded credential ID.
   */
  async createPasskey(displayName: string): Promise<string> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const userId = globalThis.crypto.getRandomValues(new Uint8Array(16));

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
      timeout: 120_000,
    };

    const credential = (await navigator.credentials.create({
      publicKey: options,
    })) as PublicKeyCredential | null;

    if (!credential) {
      throw new AppError('Passkey creation was cancelled or failed', {
        translationKey: 'errors.passkey-creation-failed',
      });
    }

    const credentialId = base64UrlEncode(new Uint8Array(credential.rawId));
    await this.store.setCredentialId(credentialId);

    return credentialId;
  }

  /**
   * Derive a P-256 signing key from the passkey PRF output.
   *
   * Flow: PRF(passkey, salt) → HKDF → 32-byte scalar d → (x, y) → CryptoKey
   *
   * Each call triggers a biometric prompt.
   */
  async deriveSigningKey(salt: Uint8Array): Promise<{
    privateKey: CryptoKey;
    publicKeyJwk: JsonWebKey;
  }> {
    // Serialize PRF evaluations to prevent concurrent biometric prompts
    while (this.prfLock) {
      await this.prfLock;
    }

    const credentialIdB64 = this.store.getCredentialId();
    if (!credentialIdB64) {
      throw new AppError('No passkey registered on this device', {
        translationKey: 'errors.no-passkey',
      });
    }

    const credentialIdBytes = base64UrlDecode(credentialIdB64);

    let resolve: () => void;
    this.prfLock = new Promise<void>(r => resolve = r);

    try {
      const prfOutput = await this.evaluatePrf(credentialIdBytes, salt);
      return this.deriveP256KeyFromBytes(prfOutput, salt);
    } finally {
      this.prfLock = null;
      resolve!();
    }
  }

  /** Remove the stored passkey credential ID (logout / reset). */
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

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: credentialId, type: 'public-key' }],
        userVerification: 'required',
        extensions: {
          // @ts-ignore — PRF extension not yet in TS lib types
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null;

    if (!assertion) {
      throw new AppError('Passkey authentication was cancelled', {
        translationKey: 'errors.passkey-auth-cancelled',
      });
    }

    const extensions = assertion.getClientExtensionResults() as any;
    const prfResults = extensions?.prf?.results;

    if (!prfResults?.first) {
      throw new AppError(
        'PRF extension not supported by this authenticator',
        { translationKey: 'errors.prf-not-supported' }
      );
    }

    return new Uint8Array(prfResults.first);
  }

  private async deriveP256KeyFromBytes(
    prfOutput: Uint8Array,
    salt: Uint8Array
  ): Promise<{ privateKey: CryptoKey; publicKeyJwk: JsonWebKey }> {
    // Step 1: Import PRF output as HKDF master key
    const masterKey = await globalThis.crypto.subtle.importKey(
      'raw',
      prfOutput,
      'HKDF',
      false,
      ['deriveBits']
    );

    // Step 2: Derive 256 bits via HKDF
    const derivedBits = await globalThis.crypto.subtle.deriveBits(
      {
        name: 'HKDF',
        salt,
        hash: 'SHA-256',
        info: new TextEncoder().encode(HKDF_INFO),
      },
      masterKey,
      256
    );

    const d = new Uint8Array(derivedBits);

    // Step 3: Compute public key point using @noble/curves
    const publicKeyUncompressed = p256.getPublicKey(d, false); // 65 bytes: 04 || x || y
    const x = publicKeyUncompressed.slice(1, 33);
    const y = publicKeyUncompressed.slice(33, 65);

    const dB64 = base64UrlEncode(d);
    const xB64 = base64UrlEncode(x);
    const yB64 = base64UrlEncode(y);

    // Step 4: Import as non-extractable ECDSA CryptoKey
    const privateKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: dB64, x: xB64, y: yB64 },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false, // non-extractable
      ['sign']
    );

    const publicKeyJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: xB64, y: yB64 };

    return { privateKey, publicKeyJwk };
  }

  private async detectPrfSupport(): Promise<PrfSupportStatus> {
    if (
      !globalThis.PublicKeyCredential ||
      !globalThis.crypto?.subtle ||
      !navigator.credentials
    ) {
      return 'unavailable';
    }

    // Check if the platform supports PRF via the static method (WebAuthn L3)
    try {
      const extensions =
        (PublicKeyCredential as any).getClientExtensionResults?.() ??
        undefined;

      // Heuristic: if PublicKeyCredential exists and we have a secure context,
      // assume PRF *might* be available. Definitive check happens at first use.
      const isSecure =
        globalThis.isSecureContext ??
        location.protocol === 'https:' ??
        ['localhost', '127.0.0.1'].includes(location.hostname);

      return isSecure ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}
