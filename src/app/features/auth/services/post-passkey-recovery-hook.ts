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
   * Hook invocado tras la recuperación de la cuenta con Passkey.
   * @param thumbprint Huella digital de la clave PRF.
   */
  execute(thumbprint: string): void {
    // 1. Evalúa si el Feature Flag está ON
    if (!this.featureFlags.isDomeAutoRecoveryEnabled) {
      console.log('[DOME] Auto-recovery disabled by feature flag.');
      return;
    }

    // 2. AC-10: Verifica si ya se completó previamente para no repetir
    if (this.stateService.getDomeRecoveryCompleted()) {
      console.log('[DOME] Auto-recovery already completed previously.');
      return;
    }

    const mode = this.featureFlags.isDomeModeServerEnabled ? 'server' : 'local';

    // 3. Invoca la recuperación
    this.recoveryService.recover(thumbprint, mode).pipe(
      catchError(error => {

        if (error?.message?.includes('PRF unavailable') || error?.name === 'PrfNotAvailableError') {
          console.warn('[DOME] ES-09: PRF not available on this device. Aborting auto-recovery silently.');
          return EMPTY; // Corta el flujo sin romper la app
        }
        console.error('[DOME] Error inesperado en auto-recovery:', error);
        return EMPTY;
      })
    ).subscribe();
  }
}
