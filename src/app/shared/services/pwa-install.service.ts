import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, fromEvent, of, race, timer } from 'rxjs';
import { filter, map, shareReplay, switchMap, take } from 'rxjs/operators';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Grace period after SW activation: lets Chrome evaluate the manifest before resolving false.
const SW_READY_GRACE_MS = 500;

// Absolute ceiling: guarantees installDecision$ always settles even if the SW never
// takes control (registration blocked/failed) and beforeinstallprompt never fires.
export const INSTALL_DECISION_HARD_TIMEOUT_MS = 4000;

// Set by markPreUpdateReload() right before an SW-update reload of an already-standalone
// session, and consumed once on the next boot. Covers browsers (notably macOS Safari "Add
// to Dock") where display-mode/navigator.standalone can read unreliably on the very first
// evaluation right after such a reload, which would otherwise show the install screen again
// on an app that is already installed.
export const POST_UPDATE_STANDALONE_GRACE_KEY = 'wallet_pwa_post_update_standalone';

function isIosPlatform(): boolean {
  const ua = navigator.userAgent;
  return /iP(hone|ad)/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

function isMacSafariDesktop(): boolean {
  const ua = navigator.userAgent;
  const isMac = ua.includes('Macintosh') && navigator.maxTouchPoints === 0;
  const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua);
  return isMac && isSafari;
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
    if (this.consumePostUpdateStandaloneGrace()) return of(false);
    if (isIosPlatform()) return of(false);
    if (this.isMacSafari) return of(true);

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

    // Hard ceiling: if the SW never claims this page and no prompt ever fires
    // (e.g. registration blocked/failed in this environment), fall back to
    // "no install screen" instead of hanging installDecision$ forever.
    const hardTimeout$: Observable<boolean> = timer(INSTALL_DECISION_HARD_TIMEOUT_MS).pipe(
      map(() => false),
    );

    return race(promptArrived$, swReadyThenGrace$, hardTimeout$).pipe(take(1));
  }

  /**
   * Called by SwUpdateService right before it reloads the page to apply a new
   * version. If this session is currently standalone, persists a one-shot marker
   * so the post-reload boot trusts it even if the synchronous display-mode check
   * misreads it during that specific reload.
   */
  markPreUpdateReload(): void {
    if (this.isStandalone) {
      sessionStorage.setItem(POST_UPDATE_STANDALONE_GRACE_KEY, 'true');
    }
  }

  private consumePostUpdateStandaloneGrace(): boolean {
    if (sessionStorage.getItem(POST_UPDATE_STANDALONE_GRACE_KEY) !== 'true') return false;
    sessionStorage.removeItem(POST_UPDATE_STANDALONE_GRACE_KEY);
    return true;
  }

  async promptInstall(): Promise<boolean> {
    if (!this.deferredPrompt) return false;
    this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    this.deferredPrompt = null;
    this.canInstall$.next(false);
    return outcome === 'accepted';
  }

  get isMacSafari(): boolean {
    return isMacSafariDesktop() && !this.isStandalone;
  }

  get isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as any).standalone === true;
  }
}
