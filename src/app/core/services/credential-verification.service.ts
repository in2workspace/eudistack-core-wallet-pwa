import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import * as pako from 'pako';
import * as dayjs from 'dayjs';
import { VerifiableCredential } from '../models/verifiable-credential';

export type CheckStatus = 'pending' | 'checking' | 'passed' | 'failed';

export interface VerificationCheck {
  key: string;
  status: CheckStatus;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class CredentialVerificationService {
  private readonly http = inject(HttpClient);

  /** Returns the ordered list of check keys to run */
  getCheckKeys(): string[] {
    return ['issuer', 'issuance', 'expiration', 'status'];
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
      return { key: 'expiration', status: 'passed', detail: 'No expiry' };
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
    const status = credential.credentialStatus;
    if (!status?.statusListCredential || !status?.statusListIndex) {
      if (credential.lifeCycleStatus === 'REVOKED') {
        return { key: 'status', status: 'failed' };
      }
      return { key: 'status', status: 'passed', detail: 'No status list' };
    }

    try {
      const jwt = await firstValueFrom(
        this.http.get(status.statusListCredential, { responseType: 'text' })
      );
      const revoked = this.checkBitInStatusList(jwt, status.statusListIndex);
      return { key: 'status', status: revoked ? 'failed' : 'passed' };
    } catch {
      const fallbackRevoked = credential.lifeCycleStatus === 'REVOKED';
      return { key: 'status', status: fallbackRevoked ? 'failed' : 'passed' };
    }
  }

  private checkBitInStatusList(jwt: string, index: string): boolean {
    const bitIndex = parseInt(index, 10);
    if (isNaN(bitIndex)) return false;

    const payload = this.decodeJwtPayload(jwt);

    let encodedList: string | undefined =
      payload?.vc?.credentialSubject?.encodedList;

    if (!encodedList && payload?.status_list?.lst) {
      return this.checkTokenStatusList(payload.status_list.lst, payload.status_list.bits ?? 1, bitIndex);
    }

    if (!encodedList) return false;

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
