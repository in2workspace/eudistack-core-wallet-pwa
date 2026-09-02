import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as pako from 'pako';
import dayjs from 'dayjs';
import { VerifiableCredential } from '../models/verifiable-credential';

export type CheckStatus = 'pending' | 'checking' | 'passed' | 'failed' | 'error';

export interface VerificationCheck {
  key: string;
  status: CheckStatus;
  detail?: string;
}

/**
 * Outcome of a revocation check against the status list.
 * 'unknown' means the status could not be determined (unreachable or unparseable) —
 * never inferred as 'not-revoked'.
 */
export type RevocationCheckResult = 'revoked' | 'not-revoked' | 'unknown';

@Injectable({ providedIn: 'root' })
export class CredentialVerificationService {
  private readonly http = inject(HttpClient);

  /** Returns the ordered list of check keys to run */
  getCheckKeys(): string[] {
    return ['issuer', 'issuance', 'expiration', 'status'];
  }

  /** Checks if a credential is revoked via its bitstring status list */
  async isRevoked(credential: VerifiableCredential): Promise<RevocationCheckResult> {
    return this.checkRevocationStatus(credential);
  }

  /**
   * Resolves revocation status from the bitstring status list.
   * Returns 'unknown' whenever the status can't be determined — a network/backend
   * fetch failure, or a 200 response whose body can't be parsed into a usable
   * status list (malformed JWT, unrecognized shape, non-numeric index). Neither
   * case MUST be reported as 'not-revoked' (fail-open would let a revoked
   * credential look valid). A credential already known locally as REVOKED stays
   * 'revoked' even under uncertainty — that fact doesn't need re-confirming.
   */
  private async checkRevocationStatus(credential: VerifiableCredential): Promise<RevocationCheckResult> {
    const status = credential.credentialStatus;
    if (!status?.statusListCredential || !status?.statusListIndex) {
      return credential.lifeCycleStatus === 'REVOKED' ? 'revoked' : 'not-revoked';
    }
    try {
      const jwt = await firstValueFrom(
        this.http.get(status.statusListCredential, { responseType: 'text' })
      );
      const revoked = this.checkBitInStatusList(jwt, status.statusListIndex);
      if (revoked === null) {
        return this.fallbackOnUncertainty(credential);
      }
      return revoked ? 'revoked' : 'not-revoked';
    } catch {
      return this.fallbackOnUncertainty(credential);
    }
  }

  /** Shared fallback when the status list fetch fails or its content can't be parsed. */
  private fallbackOnUncertainty(credential: VerifiableCredential): RevocationCheckResult {
    return credential.lifeCycleStatus === 'REVOKED' ? 'revoked' : 'unknown';
  }

  /** Runs a single named check and returns the result */
  async runCheck(key: string, credential: VerifiableCredential): Promise<VerificationCheck> {
    switch (key) {
      case 'issuer':    return this.checkIssuer(credential);
      case 'issuance':  return this.checkIssuanceDate(credential);
      case 'expiration': return this.checkExpirationDate(credential);
      case 'status':    return this.checkStatusList(credential);
      default:          return { key, status: 'failed' };
    }
  }

  private checkIssuer(credential: VerifiableCredential): VerificationCheck {
    const issuer = credential.issuer;
    if (!issuer || (!issuer.id && !issuer.organization)) {
      return { key: 'issuer', status: 'failed' };
    }
    return {
      key: 'issuer',
      status: 'passed',
      detail: issuer.organization || issuer.id,
    };
  }

  private checkIssuanceDate(credential: VerifiableCredential): VerificationCheck {
    if (!credential.validFrom) {
      return { key: 'issuance', status: 'failed' };
    }
    const issuedAt = dayjs(credential.validFrom);
    if (!issuedAt.isValid()) {
      return { key: 'issuance', status: 'failed' };
    }
    const passed = issuedAt.isBefore(dayjs()) || issuedAt.isSame(dayjs(), 'minute');
    return {
      key: 'issuance',
      status: passed ? 'passed' : 'failed',
      detail: issuedAt.format('DD/MM/YYYY'),
    };
  }

  private checkExpirationDate(credential: VerifiableCredential): VerificationCheck {
    if (!credential.validUntil) {
      return { key: 'expiration', status: 'passed', detail: 'verification.detail-no-expiry' };
    }
    const expiry = dayjs(credential.validUntil);
    if (!expiry.isValid()) {
      return { key: 'expiration', status: 'failed' };
    }
    const passed = expiry.isAfter(dayjs());
    return {
      key: 'expiration',
      status: passed ? 'passed' : 'failed',
      detail: expiry.format('DD/MM/YYYY'),
    };
  }

  private async checkStatusList(credential: VerifiableCredential): Promise<VerificationCheck> {
    const result = await this.checkRevocationStatus(credential);

    if (result === 'unknown') {
      return { key: 'status', status: 'error', detail: 'verification.detail-check-error' };
    }
    if (result === 'revoked') {
      return { key: 'status', status: 'failed', detail: 'verification.detail-revoked' };
    }

    const hasStatusList = !!(credential.credentialStatus?.statusListCredential && credential.credentialStatus?.statusListIndex);
    return {
      key: 'status',
      status: 'passed',
      ...(!hasStatusList && { detail: 'verification.detail-no-status-list' }),
    };
  }

  /** Returns null when the status can't be determined — never false on uncertainty. */
  private checkBitInStatusList(jwt: string, index: string): boolean | null {
    const bitIndex = parseInt(index, 10);
    if (Number.isNaN(bitIndex)) return null;

    const payload = this.decodeJwtPayload(jwt);
    if (!payload) return null;

    let encodedList: string | undefined =
      payload?.vc?.credentialSubject?.encodedList
      ?? payload?.credentialSubject?.encodedList;

    if (!encodedList && payload?.status_list?.lst) {
      return this.checkTokenStatusList(payload.status_list.lst, payload.status_list.bits ?? 1, bitIndex);
    }

    if (!encodedList) return null;

    if (encodedList.startsWith('u')) {
      encodedList = encodedList.substring(1);
    }

    const compressed = this.base64urlDecode(encodedList);
    const rawBytes = pako.inflate(compressed);
    return this.isBitSet(rawBytes, bitIndex);
  }

  private checkTokenStatusList(lst: string, bitsPerStatus: number, index: number): boolean {
    const compressed = this.base64urlDecode(lst);
    const rawBytes = pako.inflate(compressed);

    if (bitsPerStatus === 1) {
      return this.isBitSet(rawBytes, index);
    }

    const statusesPerByte = 8 / bitsPerStatus;
    const byteIndex = Math.floor(index / statusesPerByte);
    const posInByte = index % statusesPerByte;
    const shift = posInByte * bitsPerStatus;
    const mask = ((1 << bitsPerStatus) - 1) << shift;
    const statusValue = (rawBytes[byteIndex] & mask) >> shift;
    return statusValue !== 0;
  }

  private isBitSet(bytes: Uint8Array, bitIndex: number): boolean {
    const byteIndex = Math.floor(bitIndex / 8);
    if (byteIndex >= bytes.length) return false;
    const bitInByte = 7 - (bitIndex % 8);
    const mask = 1 << bitInByte;
    return (bytes[byteIndex] & mask) !== 0;
  }

  private decodeJwtPayload(jwt: string): any {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    try {
      const json = atob(this.base64urlToBase64(parts[1]));
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  private base64urlToBase64(input: string): string {
    let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    if (pad) base64 += '='.repeat(4 - pad);
    return base64;
  }

  private base64urlDecode(input: string): Uint8Array {
    const binary = atob(this.base64urlToBase64(input));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
