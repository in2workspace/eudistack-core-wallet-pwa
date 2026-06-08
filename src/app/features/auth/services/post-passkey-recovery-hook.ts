import { Injectable } from '@angular/core';
import { FeatureFlagsService } from '../../../core/services/feature-flags.service';
import { DomeRecoveryStateService } from '../../../core/services/dome-recovery-state.service';
import { DomeRecoveryService } from '../../../core/services/dome-recovery.service';
import { catchError, EMPTY } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PostPasskeyRecoveryHook {

  private featureFlags: FeatureFlagsService;
  private stateService: DomeRecoveryStateService;
  private recoveryService: DomeRecoveryService;

  constructor(
    featureFlags: FeatureFlagsService,
    stateService: DomeRecoveryStateService,
    recoveryService: DomeRecoveryService
  ) {
    this.featureFlags = featureFlags;
    this.stateService = stateService;
    this.recoveryService = recoveryService;
  }

  /**
   * Executes the DOME auto-recovery flow after a successful passkey login.
   * @param thumbprint PRF-derived holder key thumbprint.
   */
  execute(thumbprint: string): void {

    if (!this.featureFlags.isDomeAutoRecoveryEnabled) {
      console.log('[DOME] Auto-recovery disabled by feature flag.');
      return;
    }

    if (this.stateService.getDomeRecoveryCompleted()) {
      console.log('[DOME] Auto-recovery already completed previously.');
      return;
    }

    const mode = this.featureFlags.isDomeModeServerEnabled ? 'server' : 'local';

    this.recoveryService.recover(thumbprint, mode).pipe(
      catchError(error => {

        if (error?.message?.includes('PRF unavailable') || error?.name === 'PrfNotAvailableError') {
          console.warn('[DOME] ES-09: PRF not available on this device. Aborting auto-recovery silently.');
          return EMPTY;
        }
        console.error('[DOME] Unexpected error during auto-recovery.', error);
        return EMPTY;
      })
    ).subscribe();
  }
}
