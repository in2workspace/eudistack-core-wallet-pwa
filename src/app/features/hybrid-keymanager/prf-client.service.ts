import { inject, Injectable } from '@angular/core';
import { AppError } from 'src/app/core/models/error/AppError';
import { PasskeyPrfService } from 'src/app/core/services/passkey-prf.service';

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
      const result = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [
            {
              type: 'public-key',
              id: Uint8Array.from(
                atob(
                  credentialId
                    .replace(/-/g, '+')
                    .replace(/_/g, '/')
                ),
                c => c.charCodeAt(0)
              ),
            },
          ],
          extensions: {
            prf: {
              eval: {
                first: PRF_DETECTION_PROBE,
              },
            },
          } as AuthenticationExtensionsClientInputs,
          userVerification: 'required',
        },
      } as CredentialRequestOptions);

      if (!result) {
        return 'inconclusive';
      }

      const assertion = result as PublicKeyCredential;

      const prfResults =
        assertion.getClientExtensionResults() as {
          prf?: {
            results?: {
              first?: ArrayBuffer;
            };
          };
        };

      return prfResults?.prf?.results?.first
        ? 'enabled'
        : 'disabled';
    } catch (err) {

      if (err instanceof DOMException) {
        return 'inconclusive';
      }

      return 'inconclusive';
    }
  }

  async evaluateForWrap(prfSalt: Uint8Array): Promise<Uint8Array> {
    const credentialId = this.prfService.getCredentialId();
    if (!credentialId) {
      throw new AppError('No registered passkey found', {
        code: 'unknown',
        translationKey: 'hybrid.error.noPasskey',
      });
    }

    let assertion: PublicKeyCredential;
    try {
      const result = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [
            {
              type: 'public-key',
              id: Uint8Array.from(atob(credentialId.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
            },
          ],
          extensions: {
            prf: { eval: { first: prfSalt } },
          } as AuthenticationExtensionsClientInputs,
          userVerification: 'required',
        },
      } as CredentialRequestOptions);

      if (!result) {
        throw new AppError('Passkey assertion was cancelled', {
          code: 'unknown',
          translationKey: 'hybrid.error.assertionCancelled',
        });
      }
      assertion = result as PublicKeyCredential;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Passkey assertion failed', {
        code: 'unknown',
        cause: err,
        translationKey: 'hybrid.error.assertionFailed',
      });
    }

    const prfResults = assertion.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } };
    const prfOutput = prfResults?.prf?.results?.first;
    if (!prfOutput) {
      throw new AppError('PRF extension not supported or returned no output', {
        code: 'unknown',
        translationKey: 'hybrid.error.prfUnavailable',
      });
    }

    return new Uint8Array(prfOutput);
  }
}
