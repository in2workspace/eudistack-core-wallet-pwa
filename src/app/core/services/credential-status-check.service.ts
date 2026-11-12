import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import dayjs from 'dayjs';
import { CredentialCacheService } from '../../shared/services/credential-cache.service';
import { LifeCycleStatus, VerifiableCredential } from '../models/verifiable-credential';
import { CredentialVerificationService } from './credential-verification.service';
import { WalletService } from './wallet.service';

/**
 * Checks the status of the valid attestations in the local copy: expiry date first, then the status list of
 * their issuer, where any mark means revoked. A change is shown at once and saved in the Wallet Unit Service,
 * so every session of the user sees it. When a status list does not answer, the attestation keeps its last
 * known status and is flagged in the cache so the detail can say it could not be checked.
 */
@Injectable({ providedIn: 'root' })
export class CredentialStatusCheckService {
  private readonly credentialCache = inject(CredentialCacheService);
  private readonly verificationService = inject(CredentialVerificationService);
  private readonly walletService = inject(WalletService);

  private readonly revokedCredentialIds = new Set<string>();
  private inFlight: Promise<void> | null = null;

  /** Checks every valid attestation. Never rejects; concurrent calls share the check in progress. */
  checkAll(): Promise<void> {
    this.inFlight ??= this.runChecks().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  /** Keeps a revocation known in this session, in case reloading the copy brings back the old status. */
  rememberRevocation(id: string): void {
    this.revokedCredentialIds.add(id);
  }

  reapplyKnownRevocations(): void {
    for (const id of this.revokedCredentialIds) {
      this.credentialCache.patchStatus(id, 'REVOKED');
    }
  }

  private async runChecks(): Promise<void> {
    this.checkExpiry();
    await this.checkRevocation();
  }

  private checkExpiry(): void {
    for (const cred of this.credentialCache.snapshot().credentials) {
      if (cred.lifeCycleStatus === 'VALID' && cred.validUntil) {
        const expiry = dayjs(cred.validUntil);
        if (expiry.isValid() && expiry.isBefore(dayjs())) {
          this.changeStatus(cred.id, 'EXPIRED');
        }
      }
    }
  }

  private async checkRevocation(): Promise<void> {
    const candidates = this.credentialCache.snapshot().credentials
      .filter(cred => cred.lifeCycleStatus === 'VALID' && cred.credentialStatus?.statusListCredential);

    const checks = await Promise.allSettled(
      candidates.map(async (cred) => ({ cred, result: await this.verificationService.isRevoked(cred) }))
    );

    for (const check of checks) {
      if (check.status === 'fulfilled') {
        this.applyRevocationResult(check.value.cred, check.value.result);
      }
    }
  }

  private applyRevocationResult(cred: VerifiableCredential, result: 'revoked' | 'not-revoked' | 'unknown'): void {
    if (result === 'unknown') {
      // Never read as "not revoked": it keeps its last known status.
      this.credentialCache.markStatusUnchecked(cred.id);
      return;
    }
    this.credentialCache.clearStatusUnchecked(cred.id);
    if (result === 'revoked') {
      this.revokedCredentialIds.add(cred.id);
      this.changeStatus(cred.id, 'REVOKED');
    }
  }

  private changeStatus(id: string, status: LifeCycleStatus): void {
    this.credentialCache.patchStatus(id, status);
    firstValueFrom(this.walletService.updateCredentialStatus(id, status))
      .catch((e: unknown) => console.error('Failed to persist credential status', e));
  }
}
