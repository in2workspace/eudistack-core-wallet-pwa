import { inject, Injectable } from '@angular/core';
import { AppError } from 'src/app/core/models/error/AppError';
import { base64UrlDecode, base64UrlEncode } from 'src/app/core/utils/base64url';
import { OID4VCIKeyGenContext } from 'src/app/core/spi/key-storage.provider.service';
import { ProofBuilderService } from 'src/app/core/protocol/oid4vci/proof-builder.service';
import { MemoryService } from './memory.service';
import { PrfClientService } from './prf-client.service';
import { WrapService } from './wrap.service';
import { OnboardingHybridApi } from './onboarding-hybrid.api';

export interface HybridEnrollmentResult {
  publicKeyJwk: JsonWebKey;
  /** OID4VCI proof JWT signed with the holder key before it was wrapped and zeroized. */
  jwsProof: string;
}

/**
 * Orchestrates per-credential holder key generation for `key_manager=hybrid` tenants:
 *   init -> PRF ceremony -> key generation -> OID4VCI proof signing
 *   -> HKDF wrap-key derivation -> AES-256-GCM wrap -> commit -> zeroize.
 *
 * The holder private key is signed with exactly once (the OID4VCI proof) before
 * it is wrapped and zeroized. It never leaves this service and never persists
 * (ES-05) — a single PRF/WebAuthn ceremony covers both the PRF-support gate
 * (US-07/EUDISTACK-539 AC-01: no key material is generated before it succeeds),
 * the wrap-key derivation, and the proof signature. `PrfClientService.
 * detectPrfSupport()` (a separate dummy-salt probe) is intentionally not used
 * here — running it before `evaluateForWrap()` forced two WebAuthn prompts per
 * credential for no AC-mandated reason; `evaluateForWrap()`'s own
 * `hybrid.error.prfUnavailable` failure is an equally valid "unsupported"
 * signal and still fires strictly before any key material exists.
 *
 * Spec: EUDISTACK-534 (YARD-126) AC-01, AC-02, AC-03, AC-08, ES-04, ES-05.
 */
@Injectable({ providedIn: 'root' })
export class HybridKeyEnrollmentService {
  private readonly api = inject(OnboardingHybridApi);
  private readonly memoryService = inject(MemoryService);
  private readonly prfClientService = inject(PrfClientService);
  private readonly wrapService = inject(WrapService);
  private readonly proofBuilder = inject(ProofBuilderService);

  async enroll(context: OID4VCIKeyGenContext): Promise<HybridEnrollmentResult> {
    let privateKey: CryptoKey | undefined;
    let wrapKey: CryptoKey | undefined;
    let prfOutput: Uint8Array | undefined;
    let success = false;

    try {
      // Step 1: init — obtain prf_salt from EBW
      const initResponse = await this.api.init({
        credential_id: context.credentialId,
        format: context.format,
      });

      // Step 2: single PRF ceremony — doubles as the PRF-support gate. Aborts
      // (ES-04) before any key material is generated if PRF is unavailable.
      const prfSalt = base64UrlDecode(initResponse.prf_salt);
      prfOutput = await this.evaluateForWrapOrBlock(prfSalt, context.credentialId);

      // Step 3: generate holder key pair
      const { privateKey: pk, publicKeyJwk } = await this.wrapService.generateHolderKeyPair();
      privateKey = pk;

      // Step 4: sign the OID4VCI proof while the key is still live
      const jwsProof = await this.signProof(privateKey, publicKeyJwk, context);

      // Step 5: derive AES-256-GCM wrap key from the same PRF output
      wrapKey = await this.wrapService.deriveWrapKey(prfOutput, context.credentialId);

      // Step 6: wrap private key
      const { wrappedBlob, iv, tag } = await this.wrapService.wrapPrivateKey(privateKey, wrapKey);

      // Step 7: commit — only public material leaves the device
      await this.api.commit({
        credential_id: context.credentialId,
        wrapped_blob: base64UrlEncode(wrappedBlob),
        iv: base64UrlEncode(iv),
        tag: base64UrlEncode(tag),
        kdf_algo: 'HKDF-SHA-256',
        kdf_version: 1,
        cnf_jwk: JSON.stringify(publicKeyJwk),
      });

      // Step 8: cache wrap key for subsequent signing operations
      this.memoryService.set(context.credentialId, wrapKey);
      success = true;
      return { publicKeyJwk, jwsProof };

    } catch (err) {
      throw err instanceof AppError ? err : new AppError('Hybrid key enrollment failed', { cause: err });

    } finally {
      // Private key MUST always be zeroized (ES-05) — it never persists
      if (privateKey) await this.wrapService.zeroize(privateKey);
      // Wrap key zeroized on failure; on success it lives in MemoryService
      if (!success && wrapKey) await this.wrapService.zeroize(wrapKey);
      // Raw PRF output (IKM) MUST also be zeroed — it re-derives the wrap key deterministically
      // via HKDF with a known salt/info, so leaving it live is equivalent to leaving the wrap
      // key live (security audit finding, 2026-07-06 — was zeroed in sign.service.ts but not here).
      prfOutput?.fill(0);
    }
  }

  /**
   * Runs the real PRF ceremony. If the authenticator confirms it has no PRF
   * support (`hybrid.error.prfUnavailable`), records the block event and
   * surfaces the same `errors.prf-unsupported` error the old two-ceremony gate
   * produced. Other failures (cancelled assertion, no registered passkey) are
   * not confirmed incapability — they propagate as-is so the holder can retry.
   */
  private async evaluateForWrapOrBlock(prfSalt: Uint8Array, credentialId: string): Promise<Uint8Array> {
    try {
      return await this.prfClientService.evaluateForWrap(prfSalt);
    } catch (err) {
      if (err instanceof AppError && err.translationKey === 'hybrid.error.prfUnavailable') {
        try {
          await this.api.block({ credential_id: credentialId, correlation_id: crypto.randomUUID() });
        } catch {
          // esperamos 422 prf_unsupported
        }
        throw new AppError('Authenticator does not support PRF', {
          code: 'unknown',
          translationKey: 'errors.prf-unsupported',
        });
      }
      throw err;
    }
  }

  private async signProof(
    privateKey: CryptoKey,
    publicKeyJwk: JsonWebKey,
    context: OID4VCIKeyGenContext
  ): Promise<string> {
    const { header, payload } = this.proofBuilder.createHeaderAndPayload(
      context.cNonce ?? '',
      context.issuerIdentifier,
      publicKeyJwk
    );
    const enc = new TextEncoder();
    const signingInput =
      `${base64UrlEncode(enc.encode(JSON.stringify(header)))}.` +
      base64UrlEncode(enc.encode(JSON.stringify(payload)));

    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      enc.encode(signingInput)
    );

    return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  }
}
