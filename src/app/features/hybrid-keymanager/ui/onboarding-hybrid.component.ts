import { Component, EventEmitter, inject, Input, Output } from '@angular/core';
import { base64UrlDecode, base64UrlEncode } from 'src/app/core/utils/base64url';
import { AppError } from 'src/app/core/models/error/AppError';
import { MemoryService } from '../memory.service';
import { PrfClientService } from '../prf-client.service';
import { WrapService } from '../wrap.service';
import { OnboardingHybridApi } from '../onboarding-hybrid.api';

export type OnboardingState = 'idle' | 'loading' | 'done' | 'error' | 'prf-unsupported' | 'prf-inconclusive';

/**
 * Orchestrates the full hybrid onboarding flow for a given credential:
 *   init → PRF ceremony → key generation → HKDF wrap-key derivation
 *   → AES-256-GCM wrap → commit → zeroize private key
 *
 * Security invariants (ES-04, ES-05):
 *  - Aborts before commit if PRF ceremony fails or returns no output.
 *  - Private key is always zeroized in the `finally` block.
 *  - Wrap key is zeroized on any error; kept in MemoryService (TTL 5 min) on success.
 *  - Commit body contains only public material: no holder private key, no PRF output.
 *
 * Spec: EUDISTACK-534 AC-01, AC-02, AC-03, AC-08, ES-04, ES-05; technical-design.md §3.2 T16.
 */
@Component({
  selector: 'app-onboarding-hybrid',
  standalone: true,
  template: `
    @if (state === 'loading') {
      <p>{{ 'hybrid.onboarding.loading' | translate }}</p>
    } @else if (state === 'done') {
      <p>{{ 'hybrid.onboarding.done' | translate }}</p>
    } @else if (state === 'error') {
      <p>{{ 'hybrid.onboarding.error' | translate }}</p>
    }
  `,
})
export class OnboardingHybridComponent {
  @Input({ required: true }) credentialId!: string;
  @Input() format: string = 'vc+sd-jwt';

  @Output() enrolled = new EventEmitter<{ credentialId: string }>();
  @Output() enrollmentError = new EventEmitter<AppError>();

  state: OnboardingState = 'idle';

  private readonly api = inject(OnboardingHybridApi);
  private readonly memoryService = inject(MemoryService);
  private readonly prfClientService = inject(PrfClientService);
  private readonly wrapService = inject(WrapService);

  async enroll(): Promise<void> {
    if (this.state === 'loading') return;
    this.state = 'loading';

    const prfSupport = await this.prfClientService.detectPrfSupport();

    if (prfSupport === 'disabled') {
      this.state = 'prf-unsupported';
      this.enrollmentError.emit(
        new AppError('Authenticator does not support PRF', {
          code: 'unknown',
        })
      );
      return;
    }

    if (prfSupport === 'inconclusive') {
      this.state = 'prf-inconclusive';
      this.enrollmentError.emit(
        new AppError('Unable to determine PRF support', {
          code: 'unknown',
        })
      );
      return;
    }

    let privateKey: CryptoKey | undefined;
    let wrapKey: CryptoKey | undefined;
    let success = false;

    try {
      // Step 1: init — obtain prf_salt from EBW
      const initResponse = await this.api.init({
        credential_id: this.credentialId,
        format: this.format,
      });

      // Step 2: PRF ceremony — abort (ES-04) if output is absent
      const prfSalt = base64UrlDecode(initResponse.prf_salt);
      const prfOutput = await this.prfClientService.evaluateForWrap(prfSalt);

      // Step 3: generate holder key pair
      const { privateKey: pk, publicKeyJwk } = await this.wrapService.generateHolderKeyPair();
      privateKey = pk;

      // Step 4: derive AES-256-GCM wrap key from PRF output
      wrapKey = await this.wrapService.deriveWrapKey(prfOutput, this.credentialId);

      // Step 5: wrap private key
      const { wrappedBlob, iv, tag } = await this.wrapService.wrapPrivateKey(privateKey, wrapKey);

      // Step 6: commit — only public material leaves the device
      await this.api.commit({
        credential_id: this.credentialId,
        wrapped_blob: base64UrlEncode(wrappedBlob),
        iv: base64UrlEncode(iv),
        tag: base64UrlEncode(tag),
        kdf_algo: 'HKDF-SHA-256',
        kdf_version: 1,
        cnf_jwk: JSON.stringify(publicKeyJwk),
      });

      // Step 7: cache wrap key for subsequent signing operations
      this.memoryService.set(this.credentialId, wrapKey);
      success = true;
      this.state = 'done';
      this.enrolled.emit({ credentialId: this.credentialId });

    } catch (err) {
      this.state = 'error';
      const appErr = err instanceof AppError
        ? err
        : new AppError('Hybrid onboarding failed', { cause: err });
      this.enrollmentError.emit(appErr);

    } finally {
      // Private key MUST always be zeroized (ES-05) — it never persists
      if (privateKey) await this.wrapService.zeroize(privateKey);
      // Wrap key zeroized on failure; on success it lives in MemoryService
      if (!success && wrapKey) await this.wrapService.zeroize(wrapKey);
    }
  }
}
