import { Injectable } from '@angular/core';

const SESSION_KEY_DISMISSED = 'ios_onboarding_dismissed';

/**
 * Detects iOS Safari in browser mode (not standalone) and manages the
 * "Add to Home Screen" onboarding wizard state.
 *
 * iOS PWA storage is fully isolated from Safari (localStorage, IndexedDB,
 * cookies). Users who register in Safari and then install the PWA will lose
 * all data. This service gates the auth flow on iOS to force installation first.
 *
 * Detection criteria (AC-008.1):
 *  - Device is iPhone/iPad/iPod, OR iPadOS in desktop mode (Macintosh + maxTouchPoints > 1)
 *  - Browser is Safari (UA contains "Safari", excludes CriOS/FxiOS/EdgiOS)
 *  - Not running as installed PWA (display-mode: standalone OR navigator.standalone)
 */
@Injectable({ providedIn: 'root' })
export class IosInstallService {

  /** True when running on iOS Safari in browser mode (not standalone). */
  isIosSafariBrowserMode(): boolean {
    const ua = navigator.userAgent;
    const isIosDevice =
      /iP(hone|od|ad)/.test(ua) ||
      (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    return isIosDevice && isSafari && !isStandalone;
  }

  /** True if the user has dismissed the wizard this session (sessionStorage). */
  isDismissed(): boolean {
    return sessionStorage.getItem(SESSION_KEY_DISMISSED) === 'true';
  }

  /**
   * Persists the dismissal in sessionStorage so the wizard does not reappear
   * during this browser session. It WILL reappear in the next session.
   */
  dismissOnboarding(): void {
    sessionStorage.setItem(SESSION_KEY_DISMISSED, 'true');
  }

  /**
   * Determines which wizard state to display based on bootstrap status.
   *
   * - 'not-bootstrapped': no passkey yet → show full install wizard (AC-008.3)
   * - 'already-bootstrapped': passkey exists in Safari → warn of data loss (edge case 2)
   */
  wizardState(hasPasskey: boolean): 'not-bootstrapped' | 'already-bootstrapped' {
    return hasPasskey ? 'already-bootstrapped' : 'not-bootstrapped';
  }
}
