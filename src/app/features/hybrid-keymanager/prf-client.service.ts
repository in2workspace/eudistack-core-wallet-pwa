import { inject, Injectable } from '@angular/core';
import { HybridAdapterError } from 'src/app/core/models/error/HybridAdapterError';
import { PasskeyError, runPasskeyCeremony } from 'src/app/core/models/error/PasskeyError';
import { base64UrlDecode } from 'src/app/core/utils/base64url';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';
import { WEBAUTHN_ASSERTION_HINTS } from 'src/app/core/constants/webauthn.constants';

/**
 * Thin wrapper that evaluates the WebAuthn PRF extension with a given salt.
 *
 * Returns the raw PRF output bytes (32 bytes per CTAP2.1 spec). The output
 * is used as HKDF input material for AES-256-GCM wrap key derivation.
 *
 * The PRF salt itself is NEVER logged (NFR-06).
 *
 * Spec: EUDISTACK-534 AC-01; technical-design.md §3.2 T13.
 */

export type PrfDetectionResult =
  | 'enabled'
  | 'disabled'
  | 'inconclusive';
const PRF_DETECTION_PROBE = new Uint8Array(32);

@Injectable({ providedIn: 'root' })
export class PrfClientService {
  private readonly prfService = inject(PasskeyPrfService);

  async detectPrfSupport(): Promise<PrfDetectionResult> {
    const credentialId = this.prfService.getCredentialId();

    if (!credentialId) {
      return 'inconclusive';
    }

    try {
      const assertion = await this.assertWithPrf(credentialId, PRF_DETECTION_PROBE);
      return this.readPrfOutput(assertion) ? 'enabled' : 'disabled';
    } catch {
      // Cancel, timeout or any WebAuthn failure: support could not be determined.
      return 'inconclusive';
    }
  }

  /**
   * Cancel/timeout/SecurityError surface as a classified PasskeyError (same
   * contract as login and PRF signing). Only "the authenticator answered but
   * produced no PRF output" is reported as `prf_unavailable`: that is the one
   * outcome HybridKeyEnrollmentService treats as confirmed incapability.
   */
  async evaluateForWrap(prfSalt: Uint8Array): Promise<Uint8Array> {
    const credentialId = this.prfService.getCredentialId();
    if (!credentialId) {
      throw new PasskeyError('passkey_not_found', 'get');
    }

    const prfOutput = this.readPrfOutput(await this.assertWithPrf(credentialId, prfSalt));
    if (!prfOutput) {
      throw new HybridAdapterError('PRF extension not supported or returned no output', {
        code: 'prf_unavailable',
        translationKey: 'errors.prf-unsupported',
      });
    }

    return new Uint8Array(prfOutput);
  }

  private assertWithPrf(credentialId: string, salt: Uint8Array): Promise<Credential> {
    // No `timeout`: the browser default applies, so a timeout reads as a cancel.
    return runPasskeyCeremony('get', undefined, () => navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: base64UrlDecode(credentialId) }],
        extensions: {
          prf: { eval: { first: salt } },
        } as AuthenticationExtensionsClientInputs,
        userVerification: 'required',
        hints: WEBAUTHN_ASSERTION_HINTS,
      },
    } as CredentialRequestOptions));
  }

  private readPrfOutput(credential: Credential): ArrayBuffer | undefined {
    const results = (credential as PublicKeyCredential).getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } };
    };
    return results?.prf?.results?.first;
  }
}
