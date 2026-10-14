import { inject, Injectable } from '@angular/core';
import { PasskeyPrfAdapterError } from 'src/app/core/models/error/PasskeyPrfAdapterError';
import { runPasskeyCeremony } from 'src/app/core/models/error/PasskeyError';
import { base64UrlDecode } from 'src/app/core/utils/base64url';
import { SessionPasskeyService } from 'src/app/core/services/session-passkey.service';
import { WEBAUTHN_ASSERTION_HINTS } from 'src/app/core/constants/webauthn.constants';

/**
 * Thin wrapper that evaluates the WebAuthn PRF extension with a given salt.
 *
 * Returns the raw PRF output bytes (32 bytes per CTAP2.1 spec). The output
 * is used as HKDF input material for AES-256-GCM wrap key derivation.
 *
 * The PRF is always evaluated with the passkey that opened the session: the
 * Wallet Unit Service binds each attestation to that passkey and only returns
 * the session passkey's attestations (EUD-8 FR-15, EUD-11 prd §3.3). Whether the
 * authenticator offers the PRF is checked when the passkey is registered
 * (EUD-8 FR-08), not here.
 *
 * The PRF salt itself is NEVER logged (NFR-06).
 *
 * Spec: EUDISTACK-534 AC-01; technical-design.md §3.2 T13.
 */
@Injectable({ providedIn: 'root' })
export class PrfClientService {
  private readonly sessionPasskey = inject(SessionPasskeyService);

  /**
   * Cancel/timeout/SecurityError surface as a classified PasskeyError (same
   * contract as sign-in and PRF signing). Only "the authenticator answered but
   * produced no PRF output" is reported as `prf_unavailable`.
   */
  async evaluateForWrap(prfSalt: Uint8Array): Promise<Uint8Array> {
    const credentialId = await this.sessionPasskey.resolveCredentialId();

    const prfOutput = this.readPrfOutput(await this.assertWithPrf(credentialId, prfSalt));
    if (!prfOutput) {
      throw new PasskeyPrfAdapterError('PRF extension not supported or returned no output', {
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
