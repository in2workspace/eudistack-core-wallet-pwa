import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private readonly canInstall$ = new BehaviorSubject<boolean>(false);
  readonly installable$ = this.canInstall$.asObservable();

  constructor() {
    // Pick up early-captured prompt (fires before Angular bootstraps when SW cache is active)
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
