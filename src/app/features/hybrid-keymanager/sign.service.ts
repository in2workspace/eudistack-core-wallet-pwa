import { inject, Injectable } from '@angular/core';
import { HybridAdapterError } from 'src/app/core/models/error/HybridAdapterError';
import { base64UrlDecode, base64UrlEncode } from 'src/app/core/utils/base64url';
import { MemoryService } from './memory.service';
import { PrfClientService } from './prf-client.service';
import { SignApi } from './sign.api';
import { UnwrapService } from './unwrap.service';
import { WrapService } from './wrap.service';

/**
 * Orchestrates the hybrid (Passkey PRF) delegated signing handshake for US-04.
 *
 * Flow per AC-01/AC-04:
 *   1. prepareSign → EBW returns {prf_salt, wrapped_blob, iv, tag, signing_input, correlation_id}
 *   2. Cache hit (AC-04): reuse cached unwrapKey, skip PRF ceremony.
 *      Cache miss (EC-01): run PRF ceremony → deriveUnwrapKey → cache unwrapKey.
 *   3. Unwrap holder private key (AES-256-GCM). Fails closed on tag error (AC-06/ES-03).
 *   4. SubtleCrypto.sign(ES256, holderKey, signing_input) → raw r||s → base64url.
 *   5. submitSignedAssertion → EBW verifies and assembles kb_jwt → return kb_jwt.
 *   6. finally: zeroize holderKey (AC-05). Only unwrapKey is cached, never holderKey.
 *
 * Spec: EUDISTACK-536 AC-01, AC-04, AC-05, AC-06, ES-03, ES-05, EC-01;
 * technical-design.md §3.2 T12.
 */
@Injectable({ providedIn: 'root' })
export class SignService {
  private readonly api = inject(SignApi);
  private readonly memory = inject(MemoryService);
  private readonly prfClient = inject(PrfClientService);
  private readonly unwrapSvc = inject(UnwrapService);
  private readonly wrapSvc = inject(WrapService);

  async sign(
    credentialId: string,
    vpChallenge: string,
    format: 'vc+sd-jwt' | 'jwt_vc_json' = 'vc+sd-jwt',
  ): Promise<string> {
    const prep = await this.api.prepareSign({ credential_id: credentialId, vp_challenge: vpChallenge, format });

    let unwrapKey = this.memory.get(credentialId);
    if (!unwrapKey) {
      const prfOutput = await this.prfClient.evaluateForWrap(this.decodeField(prep.prf_salt));
      unwrapKey = await this.unwrapSvc.deriveUnwrapKey(prfOutput, credentialId);
      this.memory.set(credentialId, unwrapKey);
      prfOutput.fill(0); // AC-05: zero raw PRF IKM after derivation
    }

    let holderKey: CryptoKey | undefined;
    try {
      holderKey = await this.unwrapSvc.unwrap(
        this.decodeField(prep.wrapped_blob),
        this.decodeField(prep.iv),
        this.decodeField(prep.tag),
        unwrapKey,
      );

      const sigBytes = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        holderKey,
        new TextEncoder().encode(prep.signing_input),
      );

      const sigB64 = base64UrlEncode(new Uint8Array(sigBytes));

      const resp = await this.api.submitSignedAssertion({
        credential_id: credentialId,
        signature: sigB64,
        correlation_id: prep.correlation_id,
      });

      return resp.kb_jwt;
    } catch (err) {
      if (err instanceof HybridAdapterError && err.code === 'wrap_unavailable_on_this_device') {
        // GCM tag failed → cached unwrap key is stale (wrong device); evict so next attempt re-derives.
        this.memory.delete(credentialId);
      }
      throw err;
    } finally {
      if (holderKey) {
        await this.wrapSvc.zeroize(holderKey);
      }
    }
  }

  private decodeField(value: string): Uint8Array {
    try {
      return base64UrlDecode(value);
    } catch (cause) {
      throw new HybridAdapterError('Malformed prepareSign field', {
        code: 'prepare_sign_failed',
        cause,
      });
    }
  }
}
