import { Injectable, OnDestroy, inject, isDevMode } from '@angular/core';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { Subject, filter, takeUntil } from 'rxjs';

/**
 * Activates Angular Service Worker updates immediately on VERSION_READY to
 * prevent zombie workers from serving stale assets (including manifest.webmanifest).
 */
@Injectable({ providedIn: 'root' })
export class SwUpdateService implements OnDestroy {
  private readonly swUpdate = inject(SwUpdate);
  private readonly destroy$ = new Subject<void>();

  public init(): void {
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
          document.location.reload();
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
}
