import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialCacheService } from '../../shared/services/credential-cache.service';
import { LifeCycleStatus, VerifiableCredential } from '../models/verifiable-credential';
import { hasExpired } from '../utils/credential-expiry.util';
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
  private generation = 0;
  private rerunRequested = false;

  /**
   * Checks every valid attestation. Never rejects. A call made while a check runs joins it, and asks for one
   * more pass when it ends, so a copy that changed in the meantime (a new synchronization) is checked too.
   */
  checkAll(): Promise<void> {
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    const generation = this.generation;
    const run = this.runUntilNoneIsPending(generation).finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
    return run;
  }

  /**
   * Forgets what belongs to a session that starts or ends: the revocations remembered and the check in
   * progress, whose result is discarded when it arrives.
   */
  reset(): void {
    this.generation++;
    this.revokedCredentialIds.clear();
    this.rerunRequested = false;
    this.inFlight = null;
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

  private async runUntilNoneIsPending(generation: number): Promise<void> {
    this.rerunRequested = false;
    await this.runChecks(generation);
    if (this.rerunRequested && generation === this.generation) {
      return this.runUntilNoneIsPending(generation);
    }
  }

  private async runChecks(generation: number): Promise<void> {
    this.checkExpiry();
    await this.checkRevocation(generation);
  }

  private checkExpiry(): void {
    for (const cred of this.credentialCache.snapshot().credentials) {
      if (cred.lifeCycleStatus === 'VALID' && hasExpired(cred.validUntil)) {
        this.changeStatus(cred.id, 'EXPIRED');
      }
    }
  }

  private async checkRevocation(generation: number): Promise<void> {
    const candidates = this.credentialCache.snapshot().credentials
      .filter(cred => cred.lifeCycleStatus === 'VALID' && cred.credentialStatus?.statusListCredential);

    const checks = await Promise.allSettled(
      candidates.map(async (cred) => ({ cred, result: await this.verificationService.isRevoked(cred) }))
    );

    if (generation !== this.generation) {
      return;
    }
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
