import { Injectable, OnDestroy, inject, isDevMode } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject, filter, takeUntil } from 'rxjs';
import { PwaInstallService } from '../../shared/services/pwa-install.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { BUILD_INFO } from '../constants/build-info.constants';

// Set right before an SW-update reload, alongside PwaInstallService's own grace marker.
// Consumed once on the next boot to show a one-shot "app updated" toast — never on a
// plain reopen of an already-installed session.
const JUST_UPDATED_KEY = 'wallet_pwa_just_updated';

/**
 * Activates Angular Service Worker updates immediately on VERSION_READY to
 * prevent zombie workers from serving stale assets (including manifest.webmanifest).
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService implements OnDestroy {
  private readonly swUpdate = inject(SwUpdate);
  private readonly pwaInstall = inject(PwaInstallService);
  private readonly toast = inject(ToastServiceHandler);
  private readonly destroy$ = new Subject<void>();

  public init(): void {
    this.notifyIfJustUpdated();

    if (!this.swUpdate.isEnabled) {
      return;
    }

    this.swUpdate.versionUpdates
      .pipe(
        filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'),
        takeUntil(this.destroy$),
      )
      .subscribe(() => {
        this.swUpdate.activateUpdate().then(() => {
          this.pwaInstall.markPreUpdateReload();
          sessionStorage.setItem(JUST_UPDATED_KEY, 'true');
          window.location.reload();
        }).catch(err => {
          console.error('Failed to activate SW update', err);
        });
      });

    if (!isDevMode()) {
      this.swUpdate.checkForUpdate().catch(console.warn);
    }
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private notifyIfJustUpdated(): void {
    if (sessionStorage.getItem(JUST_UPDATED_KEY) !== 'true') return;
    sessionStorage.removeItem(JUST_UPDATED_KEY);
    this.toast.showInfoToastByTranslateLabel('app-update.toast', 5000, 'info', { version: BUILD_INFO.version });
  }
}
