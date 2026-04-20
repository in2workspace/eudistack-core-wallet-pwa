import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, fromEvent, of, race, timer } from 'rxjs';
import { filter, map, shareReplay, switchMap, take } from 'rxjs/operators';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Grace period after SW activation: lets Chrome evaluate the manifest before resolving false.
const SW_READY_GRACE_MS = 500;

function isIosPlatform(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad)/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private readonly canInstall$ = new BehaviorSubject<boolean>(false);
  readonly installable$ = this.canInstall$.asObservable();
  readonly installDecision$: Observable<boolean>;

  constructor() {
    // Pick up prompt captured by the inline script in index.html before Angular bootstrapped.
    const earlyPrompt = (window as any).__pwaInstallPrompt as BeforeInstallPromptEvent | null;
    if (earlyPrompt) {
      this.deferredPrompt = earlyPrompt;
      this.canInstall$.next(true);
      (window as any).__pwaInstallPrompt = null;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall$.next(true);
    });

    window.addEventListener('appinstalled', () => {
      this.canInstall$.next(false);
      this.deferredPrompt = null;
    });

    this.installDecision$ = this.buildInstallDecision$().pipe(
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }

  private buildInstallDecision$(): Observable<boolean> {
    if (this.isStandalone) return of(false);
    if (isIosPlatform()) return of(false);

    const promptArrived$ = this.canInstall$.pipe(filter(Boolean), take(1));

    // Deterministic fallback: wait for SW to take control, then grant a short grace window.
    // If the SW already controls the page (returning visit), controllerchange never fires —
    // check controller synchronously to skip straight to the grace timer.
    const swActive$: Observable<unknown> = 'serviceWorker' in navigator
      ? (navigator.serviceWorker.controller !== null
          ? of(undefined)
          : fromEvent(navigator.serviceWorker, 'controllerchange').pipe(take(1)))
      : of(undefined);

    const swReadyThenGrace$: Observable<boolean> = swActive$.pipe(
      switchMap(() => timer(SW_READY_GRACE_MS)),
      map(() => false),
    );

    return race(promptArrived$, swReadyThenGrace$).pipe(take(1));
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.canInstall$.next(false);
    return outcome === 'accepted';
  }

  get isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
  }
}
