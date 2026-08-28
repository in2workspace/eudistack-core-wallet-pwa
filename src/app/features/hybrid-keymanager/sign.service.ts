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
 *   1. prepareSign(payload) → EBW pins signing_input from the caller-assembled payload (opaque —
 *      architecture.md §6.2 design correction 2026-07-03) → returns {prf_salt, wrapped_blob, iv,
 *      tag, signing_input, correlation_id}
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
    payload: Record<string, unknown>,
    format: 'vc+sd-jwt' | 'jwt_vc_json' = 'vc+sd-jwt',
  ): Promise<string> {
    const prep = await this.api.prepareSign({ credential_id: credentialId, payload, format });

    // Never sign an opaque server string on trust alone: a malicious/compromised EBW could
    // return a signing_input encoding different claims (aud, nonce, sd_hash, ...) than the
    // payload the client submitted, and the holder would sign it during a legitimate-looking
    // PRF ceremony — the key never leaks, but the operator would obtain a holder signature
    // over content it chose, defeating the no-custodia/holder-control guarantee (security
    // audit finding, 2026-07-06). Verify BEFORE the PRF ceremony so a bad response never
    // costs the holder a biometric prompt.
    this.verifySigningInput(prep.signing_input, payload, format);

    let unwrapKey = this.memory.get(credentialId);
    if (!unwrapKey) {
      const prfOutput = await this.prfClient.evaluateForWrap(this.decodeField(prep.prf_salt));
      try {
        unwrapKey = await this.unwrapSvc.deriveUnwrapKey(prfOutput, credentialId);
        this.memory.set(credentialId, unwrapKey);
      } finally {
        // AC-05: zero raw PRF IKM even if deriveUnwrapKey throws (security audit finding,
        // 2026-07-06 — previously skipped on the error path).
        prfOutput.fill(0);
      }
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

  /**
   * Verifies that `signing_input` (the value about to be signed) actually encodes the
   * `payload` this call submitted, and a header with the expected `alg`/`typ` for `format` —
   * without needing to byte-reconstruct the header (which for VC_JWT would additionally
   * require the holder's own public JWK/kid, not otherwise needed client-side to sign).
   */
  private verifySigningInput(
    signingInput: string,
    payload: Record<string, unknown>,
    format: 'vc+sd-jwt' | 'jwt_vc_json',
  ): void {
    const parts = signingInput.split('.');
    if (parts.length !== 2) {
      throw new HybridAdapterError('Malformed signing_input from EBW', { code: 'prepare_sign_failed' });
    }

    let header: { alg?: unknown; typ?: unknown };
    let decodedPayload: unknown;
    try {
      header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
      decodedPayload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    } catch (cause) {
      throw new HybridAdapterError('Malformed signing_input from EBW', { code: 'prepare_sign_failed', cause });
    }

    const expectedTyp = format === 'vc+sd-jwt' ? 'kb+jwt' : 'vp+jwt';
    if (header.alg !== 'ES256' || header.typ !== expectedTyp) {
      throw new HybridAdapterError(
        `signing_input header mismatch: expected alg=ES256 typ=${expectedTyp}, got alg=${String(header.alg)} typ=${String(header.typ)}`,
        { code: 'prepare_sign_failed' },
      );
    }

    if (canonicalJson(decodedPayload) !== canonicalJson(payload)) {
      throw new HybridAdapterError(
        'signing_input payload does not match the payload submitted to prepareSign — refusing to sign',
        { code: 'prepare_sign_failed' },
      );
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

/** Deterministic JSON serialization (object keys sorted, recursively) for order-independent equality. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
