import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { filter, take } from 'rxjs/operators';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { DEEP_LINK_PATH_PREFIXES, FRAGMENT_LINK_PATHS, PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

/** `continued`: the leader opened an onboarding ticket or "it was not me" link (task 46). */
type DeepLinkOutcome = 'navigated' | 'pending-login' | 'continued';

interface SingleInstanceMessage {
  type: 'NEW_TAB' | 'LEADER_ACK' | 'NAVIGATE' | 'NAVIGATE_ACK';
  tabId: string;
  url?: string;
  replyTo?: string;
  outcome?: DeepLinkOutcome;
  leaderStandalone?: boolean;
}

interface NavigateAck {
  outcome: DeepLinkOutcome;
  leaderStandalone: boolean;
}

const CHANNEL_NAME = 'wallet-single-instance';
const LEADER_LOCK_NAME = 'wallet-single-instance';
// How long a new tab waits for the leader lock when the leader does not answer. It only
// covers a reload, whose previous document may not have released the lock yet: a busy or
// throttled leader still holds it, so this tab ends up as a follower either way.
const LEADER_LOCK_WAIT_MS = 1000;
const ELECTION_TIMEOUT_MS = 300;
const NAVIGATE_ACK_TIMEOUT_MS = 500;

const DUPLICATE_TAB_COPY = {
  navigated: {
    title: 'single-instance.title-offer-ready',
    subtitle: 'single-instance.subtitle-offer-ready',
  },
  'pending-login': {
    title: 'single-instance.title-offer-pending-login',
    subtitle: 'single-instance.subtitle-offer-pending-login',
  },
  sent: {
    title: 'single-instance.title-deep-link',
    subtitle: 'single-instance.subtitle-deep-link',
  },
  'already-open': {
    title: 'single-instance.title-already-open',
    subtitle: 'single-instance.subtitle-already-open',
  },
  continued: {
    title: 'single-instance.title-continued',
    subtitle: 'single-instance.subtitle-continued',
  },
} as const;

const DUPLICATE_TAB_HINT_KEYS = {
  leaderAnswered: {
    standalone: 'single-instance.hint-go-to-window',
    tab: 'single-instance.hint-go-to-tab',
  },
  noAnswer: {
    standalone: 'single-instance.hint-standalone',
    tab: 'single-instance.hint-tab',
  },
} as const;

@Injectable({ providedIn: 'root' })
export class SingleInstanceService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  private channel: BroadcastChannel | null = null;
  private readonly tabId = crypto.randomUUID();
  private isLeader = false;
  private titleBeforeFlag: string | null = null;
  /**
   * Fragment of the address the tab was opened with, read when the app starts: the onboarding ticket and
   * the "it was not me" pages take it out of the address bar as soon as they start (AC-04), possibly before
   * the election. In memory only, and dropped once the election has used it.
   */
  private startFragment = window.location.hash;
  private resolveLeadership!: (isLeader: boolean) => void;
  private readonly leadership = new Promise<boolean>((resolve) => {
    this.resolveLeadership = resolve;
  });

  /**
   * Resolves once the election is decided: `true` in the leader tab, `false` in a duplicate one. A page that
   * consumes something single-use (the onboarding ticket) waits for it, so a duplicate tab never does.
   */
  public whenLeaderDecided(): Promise<boolean> {
    return this.leadership;
  }

  /** Resolves `true` if this tab becomes the leader, `false` if one already exists. */
  public elect(): Promise<boolean> {
    if (!('BroadcastChannel' in window)) {
      // Unsupported browser — always act as leader.
      this.resolveLeadership(true);
      return Promise.resolve(true);
    }

    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
      this.handleMessage(ev.data);
    };

    const election = 'locks' in navigator ? this.electWithLock() : this.electWithMessages();
    return election.then((isLeader) => {
      this.resolveLeadership(isLeader);
      return isLeader;
    });
  }

  /**
   * Path, query and fragment the tab was opened with. The fragment only matters for the onboarding ticket and
   * "it was not me" links, and it only travels to the leader through the same-origin channel: it never reaches
   * a server (EUD-315 P18).
   */
  private openedUrl(): string {
    const fragment = window.location.hash || this.startFragment;
    this.startFragment = '';
    return window.location.pathname + window.location.search + fragment;
  }

  /**
   * The leader is whoever holds the lock, and the browser releases it when the tab closes
   * or crashes, so two leaders cannot exist however long the current one takes to answer.
   * NEW_TAB is only sent so that a responsive leader spares this tab the wait.
   *
   * A follower leaves its request queued instead of aborting it: Chrome can keep an aborted
   * request pending without ever rejecting it, so a rejection cannot be what ends the wait.
   */
  private electWithLock(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const currentUrl = this.openedUrl();
      let decided = false;

      const becomeFollower = () => {
        if (decided) return;
        decided = true;
        clearTimeout(waitTimeout);
        void this.handOffToLeader(currentUrl);
        resolve(false);
      };
      const waitTimeout = setTimeout(becomeFollower, LEADER_LOCK_WAIT_MS);

      this.channel!.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
        if (ev.data.type === 'LEADER_ACK') {
          becomeFollower();
        } else {
          this.handleMessage(ev.data);
        }
      };

      navigator.locks.request(LEADER_LOCK_NAME, () => {
        if (decided) {
          // Late grant to a follower: returning releases the lock for the next tab.
          return undefined;
        }
        decided = true;
        clearTimeout(waitTimeout);
        this.becomeLeader();
        resolve(true);
        // Never settles: the lock is held for the whole life of the tab.
        return new Promise<void>(() => undefined);
      }).catch(() => {
        if (decided) return;
        // The browser refused the lock (e.g. site storage blocked).
        decided = true;
        clearTimeout(waitTimeout);
        resolve(this.electWithMessages());
      });

      this.postNewTab(currentUrl);
    });
  }

  /** Fallback without Web Locks: a leader that takes too long to answer ends up with a second leader. */
  private electWithMessages(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const currentUrl = this.openedUrl();

      this.postNewTab(currentUrl);
      const timeout = setTimeout(() => {
        this.becomeLeader();
        resolve(true);
      }, ELECTION_TIMEOUT_MS);

      const originalHandler = this.channel!.onmessage;
      this.channel!.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
        if (ev.data.type === 'LEADER_ACK') {
          clearTimeout(timeout);
          this.channel!.onmessage = originalHandler;
          void this.handOffToLeader(currentUrl);
          resolve(false);
        } else {
          originalHandler?.call(this.channel!, ev);
        }
      };
    });
  }

  private postNewTab(url: string): void {
    this.channel!.postMessage({
      type: 'NEW_TAB',
      tabId: this.tabId,
      url,
    } satisfies SingleInstanceMessage);
  }

  private becomeLeader(): void {
    this.isLeader = true;
    if (this.channel) {
      this.channel.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
        this.handleMessage(ev.data);
      };
    }
  }

  private async handOffToLeader(currentUrl: string): Promise<void> {
    // Cancel any pending auth operations so this follower tab cannot corrupt shared
    // storage state while it waits for the leader's answer.
    this.authService.dispose();

    const appRelative = SingleInstanceService.stripBase(currentUrl);
    if (SingleInstanceService.isFragmentLinkPath(appRelative)) {
      // AC-04: the ticket or token never stays in this tab's address bar nor history entry.
      history.replaceState(history.state, '', window.location.pathname + window.location.search);
    }
    const isFragmentLink = SingleInstanceService.isFragmentLinkPath(appRelative);
    const isDeepLink = SingleInstanceService.isDeepLinkPath(appRelative) || isFragmentLink;
    let ack: NavigateAck | null = null;
    if (isDeepLink) {
      ack = await this.requestNavigation(currentUrl);
    } else {
      this.postNavigate(currentUrl);
    }

    // A fragment link the leader did not acknowledge was not opened: say only that the wallet is open.
    this.renderDuplicateTabMessage(isDeepLink && (ack !== null || !isFragmentLink), ack);
  }

  private requestNavigation(url: string): Promise<NavigateAck | null> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), NAVIGATE_ACK_TIMEOUT_MS);
      this.channel!.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
        const { type, replyTo, outcome, leaderStandalone } = ev.data;
        if (type !== 'NAVIGATE_ACK' || replyTo !== this.tabId || !outcome) {
          return;
        }
        clearTimeout(timeout);
        resolve({ outcome, leaderStandalone: leaderStandalone === true });
      };
      this.postNavigate(url);
    });
  }

  private postNavigate(url: string): void {
    this.channel!.postMessage({
      type: 'NAVIGATE',
      tabId: this.tabId,
      url,
    } satisfies SingleInstanceMessage);
  }

  /**
   * Navigates the leader tab to a deep-link URL, or queues it for after login.
   * Accepts either a full URL (https://…) or an app-relative path (/tabs/…).
   */
  public handleDeepLink(url: string): void {
    let appRelative: string;
    try {
      // Full URL — strip origin and base href
      const parsed = new URL(url);
      appRelative = SingleInstanceService.stripBase(parsed.pathname + parsed.search);
    } catch {
      // Already app-relative
      appRelative = SingleInstanceService.stripBase(url);
    }

    // On a cold launch the start-up session resume may still be running: decide
    // between navigating and queueing for after login once the session state is known.
    this.whenAuthInitialized(() => this.applyDeepLink(appRelative));
  }

  private whenAuthInitialized(run: () => void): void {
    this.authService.isInitialized$().pipe(filter(Boolean), take(1)).subscribe(() => run());
  }

  private applyDeepLink(appRelative: string): DeepLinkOutcome {
    if (this.authService.isLoggedIn()) {
      this.router.navigateByUrl(appRelative);
      return 'navigated';
    }
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, appRelative);
    return 'pending-login';
  }

  /**
   * Registers a launchQueue consumer so that, when the PWA is installed and
   * launch_handler.client_mode is "navigate-existing", Chromium focuses the
   * existing window and forwards the target URL here instead of opening a new one.
   */
  public consumeLaunchQueue(): void {
    if (!('launchQueue' in window)) return;
    (window as any).launchQueue.setConsumer((launchParams: { targetURL?: string }) => {
      if (launchParams.targetURL) {
        this.handleDeepLink(launchParams.targetURL);
      }
    });
  }

  private handleMessage(msg: SingleInstanceMessage): void {
    if (msg.tabId === this.tabId) {
      return; // ignore own messages
    }

    if (!this.isLeader) {
      return;
    }

    switch (msg.type) {
      case 'NEW_TAB':
        this.channel!.postMessage({
          type: 'LEADER_ACK',
          tabId: this.tabId,
        } satisfies SingleInstanceMessage);
        break;

      case 'NAVIGATE': {
        window.focus();
        // Strip the base href from the raw pathname+search sent by the follower.
        // APP_BASE_HREF token resolves to '/' in some setups, so we read the
        // <base href> directly from the DOM for reliability.
        const appRelative = SingleInstanceService.stripBase(msg.url ?? '');

        if (SingleInstanceService.isFragmentLinkPath(appRelative)) {
          // EUD-315 (task 46): opened right away, with or without a session; the page decides (AC-09, EC-02).
          void this.openFragmentLink(appRelative);
          this.channel!.postMessage({
            type: 'NAVIGATE_ACK',
            tabId: this.tabId,
            replyTo: msg.tabId,
            outcome: 'continued',
            leaderStandalone: SingleInstanceService.isStandalone(),
          } satisfies SingleInstanceMessage);
        } else if (SingleInstanceService.isDeepLinkPath(appRelative)) {
          this.whenAuthInitialized(() => {
            const outcome = this.applyDeepLink(appRelative);
            this.flagPendingOffer();
            this.channel!.postMessage({
              type: 'NAVIGATE_ACK',
              tabId: this.tabId,
              replyTo: msg.tabId,
              outcome,
              leaderStandalone: SingleInstanceService.isStandalone(),
            } satisfies SingleInstanceMessage);
          });
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Browsers do not let a background tab bring itself to the front, so when an offer lands
   * while this tab is hidden its title is prefixed until the user comes back to it.
   */
  private flagPendingOffer(): void {
    if (!document.hidden || this.titleBeforeFlag !== null) {
      return;
    }

    this.titleBeforeFlag = document.title;
    document.title = `${this.translate.instant('single-instance.tab-title-pending-offer')} · ${this.titleBeforeFlag}`;

    const restoreTitle = () => {
      if (document.hidden) {
        return;
      }
      document.removeEventListener('visibilitychange', restoreTitle);
      document.title = this.titleBeforeFlag ?? document.title;
      this.titleBeforeFlag = null;
    };
    document.addEventListener('visibilitychange', restoreTitle);
  }

  private renderDuplicateTabMessage(isDeepLink: boolean, ack: NavigateAck | null = null): void {
    this.channel?.close();
    this.channel = null;

    // Describe the tab the user has to go to: the leader's, when it told us, so a link
    // opened in a browser tab does not say "tab" while the wallet lives in the installed PWA window.
    const isStandalone = ack?.leaderStandalone ?? SingleInstanceService.isStandalone();
    const typeKey = isStandalone ? 'single-instance.type-window' : 'single-instance.type-tab';
    const type = this.translate.instant(typeKey);
    const params = { type };

    const scenario = ack?.outcome ?? (isDeepLink ? 'sent' : 'already-open');
    const copy = DUPLICATE_TAB_COPY[scenario];
    const title = this.translate.instant(copy.title);
    document.title = title;
    const subtitle = this.translate.instant(copy.subtitle, params);
    const displayMode = isStandalone ? 'standalone' : 'tab';
    const hintKeys = ack ? DUPLICATE_TAB_HINT_KEYS.leaderAnswered : DUPLICATE_TAB_HINT_KEYS.noAnswer;
    const hint = this.translate.instant(hintKeys[displayMode]);
    const closeFallback = this.translate.instant(
      isStandalone ? 'single-instance.close-fallback-standalone' : 'single-instance.close-fallback-tab'
    );

    document.body.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;font-family:sans-serif;gap:16px;color:#001E8C;text-align:center;
        padding:24px;box-sizing:border-box;">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        <h2 style="margin:0;font-size:1.25rem;">${title}</h2>
        <p style="margin:0;font-size:.9rem;color:#555;max-width:320px;line-height:1.5;">
          ${subtitle}
        </p>
        <p style="margin:0;font-size:.8rem;color:#aaa;max-width:320px;">${hint}</p>
        <button id="__wallet_close_btn" style="
          margin-top:8px;padding:10px 24px;border:none;border-radius:8px;
          background:#001E8C;color:#fff;font-size:.9rem;cursor:pointer;">
          ${this.translate.instant('single-instance.close-button', params)}
        </button>
      </div>`;

    const closeBtn = document.getElementById('__wallet_close_btn') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => {
      window.close();
      setTimeout(() => {
        closeBtn.textContent = closeFallback;
        closeBtn.style.background = '#555';
        closeBtn.style.cursor = 'default';
        closeBtn.disabled = true;
      }, 300);
    });
  }

  public ngOnDestroy(): void {
    this.channel?.close();
  }

  /**
   * The ticket and "it was not me" pages read their value when they start: if the leader already shows that
   * page, it goes through the root first so that the page starts again with the new fragment.
   */
  private async openFragmentLink(appRelative: string): Promise<void> {
    const pathOf = (url: string) => url.split(/[?#]/)[0];
    if (pathOf(this.router.url ?? '') === pathOf(appRelative)) {
      await this.router.navigateByUrl('/', { skipLocationChange: true });
    }
    await this.router.navigateByUrl(appRelative);
  }

  private static isDeepLinkPath(appRelative: string): boolean {
    return DEEP_LINK_PATH_PREFIXES.some((prefix) => appRelative.startsWith(prefix));
  }

  /** `/t#…` or `/no-he-sido-yo#…` (exact path, any query or fragment). */
  private static isFragmentLinkPath(appRelative: string): boolean {
    const path = appRelative.split(/[?#]/)[0];
    return FRAGMENT_LINK_PATHS.some((linkPath) => path === linkPath);
  }

  // iOS Safari PWAs expose navigator.standalone instead of display-mode:standalone.
  private static isStandalone(): boolean {
    return window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
  }

  private static stripBase(url: string): string {
    const base = (document.querySelector('base')?.getAttribute('href') ?? '/').replace(/\/$/, '');
    if (!base) return url;
    if (!url.startsWith(base)) return url;
    const rest = url.slice(base.length);
    // Only strip when the match ends on a path segment boundary.
    if (rest === '' || rest.startsWith('/')) return rest || '/';
    if (rest.startsWith('?') || rest.startsWith('#')) return '/' + rest;
    return url;
  }
}
