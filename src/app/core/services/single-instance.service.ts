import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { DEEP_LINK_PATH_PREFIXES, PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

type DeepLinkOutcome = 'navigated' | 'pending-login';

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

  /** Resolves `true` if this tab becomes the leader, `false` if one already exists. */
  public elect(): Promise<boolean> {
    if (!('BroadcastChannel' in window)) {
      // Unsupported browser — always act as leader.
      return Promise.resolve(true);
    }

    this.channel = new BroadcastChannel(CHANNEL_NAME);
    this.channel.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
      this.handleMessage(ev.data);
    };

    return new Promise<boolean>((resolve) => {
      const currentUrl = window.location.pathname + window.location.search;

      this.channel!.postMessage({
        type: 'NEW_TAB',
        tabId: this.tabId,
        url: currentUrl,
      } satisfies SingleInstanceMessage);
// TODO: There is a potential race condition here. This should be improved in a future update.
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

    const isDeepLink = SingleInstanceService.isDeepLinkPath(SingleInstanceService.stripBase(currentUrl));
    let ack: NavigateAck | null = null;
    if (isDeepLink) {
      ack = await this.requestNavigation(currentUrl);
    } else {
      this.postNavigate(currentUrl);
    }

    this.renderDuplicateTabMessage(isDeepLink, ack);
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

    this.applyDeepLink(appRelative);
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

        if (SingleInstanceService.isDeepLinkPath(appRelative)) {
          const outcome = this.applyDeepLink(appRelative);
          this.flagPendingOffer();
          this.channel!.postMessage({
            type: 'NAVIGATE_ACK',
            tabId: this.tabId,
            replyTo: msg.tabId,
            outcome,
            leaderStandalone: SingleInstanceService.isStandalone(),
          } satisfies SingleInstanceMessage);
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

  private static isDeepLinkPath(appRelative: string): boolean {
    return DEEP_LINK_PATH_PREFIXES.some((prefix) => appRelative.startsWith(prefix));
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
