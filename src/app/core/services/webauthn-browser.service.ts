import { Injectable } from '@angular/core';
import { browserSupportsWebAuthn, getBrowserCapabilities, sendSignal } from '@simplewebauthn/browser';

type SignalMethod = 'signalUnknownCredential' | 'signalAllAcceptedCredentials' | 'signalCurrentUserDetails';

/**
 * Browser capabilities the access screen depends on: passkey support (FR-01) and
 * the WebAuthn Signal API (FR-17), which keeps the system passkey manager in step
 * with the passkeys the Wallet Unit Service accepts.
 *
 * Every signal is feature-detected and best effort: a browser without the
 * Signal API (Firefox today) simply keeps showing the passkey, and the access
 * screen explains what to do instead.
 */
@Injectable({ providedIn: 'root' })
export class WebAuthnBrowserService {

  /**
   * False only when the browser cannot run a passkey ceremony at all: no
   * WebAuthn, no secure context, or a client that reports every way of using a
   * passkey (platform, user-verifying platform, nearby device) as unsupported.
   * An `unknown` capability counts as supported: older browsers do not
   * implement `getClientCapabilities()` and still handle passkeys.
   */
  async isPasskeySupported(): Promise<boolean> {
    if (globalThis.isSecureContext === false || !browserSupportsWebAuthn()) {
      return false;
    }
    try {
      const capabilities = await getBrowserCapabilities();
      return !(
        capabilities.passkeyPlatformAuthenticator === 'unsupported' &&
        capabilities.userVerifyingPlatformAuthenticator === 'unsupported' &&
        capabilities.hybridTransport === 'unsupported'
      );
    } catch {
      // A broken capabilities probe says nothing about the ceremony itself, which still runs.
      return true;
    }
  }

  /** Asks the passkey manager to hide a passkey the service does not accept. */
  async signalUnknownCredential(rpId: string, credentialId: string): Promise<void> {
    if (!this.supports('signalUnknownCredential')) return;
    await this.send(() => sendSignal({ signalName: 'unknownCredential', rpID: rpId, credentialID: credentialId }));
  }

  /** Tells the passkey manager which passkeys of the account the service accepts. */
  async signalAllAcceptedCredentials(rpId: string, userId: string, credentialIds: string[]): Promise<void> {
    if (!this.supports('signalAllAcceptedCredentials')) return;
    await this.send(() => sendSignal({
      signalName: 'allAcceptedCredentials',
      rpID: rpId,
      userID: userId,
      allAcceptedCredentialIDs: credentialIds,
    }));
  }

  /** Updates the name the passkey manager shows for the account (its email). */
  async signalCurrentUserDetails(rpId: string, userId: string, name: string): Promise<void> {
    if (!this.supports('signalCurrentUserDetails')) return;
    await this.send(() => sendSignal({
      signalName: 'currentUserDetails',
      rpID: rpId,
      userID: userId,
      userName: name,
      userDisplayName: name,
    }));
  }

  private supports(method: SignalMethod): boolean {
    const publicKeyCredential = globalThis.PublicKeyCredential as unknown as Partial<Record<SignalMethod, unknown>> | undefined;
    return typeof publicKeyCredential?.[method] === 'function';
  }

  private async send(signal: () => Promise<unknown>): Promise<void> {
    try {
      await signal();
    } catch (err) {
      // WebAuthn L3 Signal API: signals are fire-and-forget hints to the passkey manager;
      // a rejected one changes nothing for the user, so it must never break the flow.
      console.warn('[WebAuthnBrowserService] Passkey signal rejected', err);
    }
  }
}
