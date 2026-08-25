import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from './auth.service';
import { InstanceGroupService } from './instance-group.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

interface SingleInstanceMessage {
  type: 'NEW_TAB' | 'LEADER_ACK' | 'NAVIGATE';
  tabId: string;
  url?: string;
}

/** Minimal surface both a same-origin `BroadcastChannel` and `RelayTransport` implement. */
interface MessageTransport {
  postMessage(data: SingleInstanceMessage): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  close(): void;
}

const CHANNEL_NAME = 'wallet-single-instance';
const ELECTION_TIMEOUT_MS = 300;
const RELAY_CONNECT_TIMEOUT_MS = 400;

/**
 * Bridges the single-instance `BroadcastChannel` across origins that are
 * front-door aliases for the same wallet backend (see `InstanceGroup`).
 *
 * `BroadcastChannel` is scoped per-origin by the browser, so two tabs open
 * on different aliases (e.g. the canonical domain and a DOME vanity domain)
 * can never see each other directly. This class embeds a hidden iframe
 * pointed at a fixed "anchor" URL (`brokerUrl`) shared by every member of
 * the group; because the iframe always runs in that one origin regardless
 * of which member origin embeds it, a `BroadcastChannel` opened inside it
 * (see `instance-broker.html`) is genuinely shared across the whole group.
 * This class only relays postMessage traffic to/from that iframe — it knows
 * nothing about the single-instance protocol itself.
 */
export class RelayTransport implements MessageTransport {
  public onmessage: ((ev: MessageEvent) => void) | null = null;

  private readonly onWindowMessage = (event: MessageEvent): void => {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.brokerOrigin) {
      return;
    }
    if (event.data?.type === 'RELAY_IN') {
      this.onmessage?.({ data: event.data.payload } as MessageEvent);
    }
  };

  private constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly brokerOrigin: string,
  ) {
    window.addEventListener('message', this.onWindowMessage);
  }

  /** Resolves once the broker iframe confirms readiness, or `null` on timeout/failure. */
  public static connect(brokerUrl: string, timeoutMs: number): Promise<RelayTransport | null> {
    return new Promise((resolve) => {
      let settled = false;
      const brokerOrigin = new URL(brokerUrl).origin;
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.setAttribute('aria-hidden', 'true');
      iframe.src = brokerUrl;

      const onReady = (event: MessageEvent): void => {
        if (settled || event.source !== iframe.contentWindow || event.origin !== brokerOrigin) {
          return;
        }
        if (event.data?.type === 'BROKER_READY') {
          settled = true;
          clearTimeout(timeout);
          window.removeEventListener('message', onReady);
          resolve(new RelayTransport(iframe, brokerOrigin));
        }
      };

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onReady);
        iframe.remove();
        resolve(null);
      }, timeoutMs);

      window.addEventListener('message', onReady);
      document.body.appendChild(iframe);
    });
  }

  public postMessage(data: SingleInstanceMessage): void {
    this.iframe.contentWindow?.postMessage({ type: 'RELAY_OUT', payload: data }, this.brokerOrigin);
  }

  public close(): void {
    window.removeEventListener('message', this.onWindowMessage);
    this.iframe.remove();
  }
}

@Injectable({ providedIn: 'root' })
export class SingleInstanceService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly instanceGroupService = inject(InstanceGroupService);

  private channel: MessageTransport | null = null;
  private readonly tabId = crypto.randomUUID();
  private isLeader = false;

  /** Resolves `true` if this tab becomes the leader, `false` if one already exists. */
  public async elect(): Promise<boolean> {
    if (!('BroadcastChannel' in window)) {
      // Unsupported browser — always act as leader.
      return true;
    }

    this.channel = await this.acquireTransport();
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
          this.channel!.postMessage({
            type: 'NAVIGATE',
            tabId: this.tabId,
            url: currentUrl,
          } satisfies SingleInstanceMessage);
          this.channel!.onmessage = originalHandler;
          const appRelative = SingleInstanceService.stripBase(currentUrl);
          const isDeepLink = appRelative.startsWith('/protocol/') || appRelative.startsWith('/tabs/vc-selector') || appRelative.startsWith('/tabs/credentials');
          this.renderDuplicateTabMessage(isDeepLink);
          resolve(false);
        } else {
          originalHandler?.call(this.channel!, ev);
        }
      };
    });
  }

  /**
   * Resolves the transport used for this tab's election. Grouped origins
   * (front-door aliases sharing a backend) get the cross-origin relay;
   * everything else — including localhost dev-network origins, which are
   * never listed in any instance group — keeps the plain same-origin
   * `BroadcastChannel`, unchanged from before this class existed.
   */
  private async acquireTransport(): Promise<MessageTransport> {
    const group = await this.instanceGroupService.resolveGroupForOrigin();
    if (group) {
      const relay = await RelayTransport.connect(group.brokerUrl, RELAY_CONNECT_TIMEOUT_MS);
      if (relay) {
        return relay;
      }
      console.warn(
        `[SingleInstanceService] Instance broker for group "${group.id}" did not respond within ${RELAY_CONNECT_TIMEOUT_MS}ms.`,
        `Falling back to same-origin leader election — duplicate-tab detection will NOT span ${group.memberOrigins.join(', ')} for this tab.`,
      );
    }
    return new BroadcastChannel(CHANNEL_NAME);
  }

  private becomeLeader(): void {
    this.isLeader = true;
    if (this.channel) {
      this.channel.onmessage = (ev: MessageEvent<SingleInstanceMessage>) => {
        this.handleMessage(ev.data);
      };
    }
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

    if (this.authService.isLoggedIn()) {
      this.router.navigateByUrl(appRelative);
    } else {
      sessionStorage.setItem(PENDING_DEEP_LINK_KEY, appRelative);
    }
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

        if (appRelative.startsWith('/protocol/') || appRelative.startsWith('/tabs/vc-selector') || appRelative.startsWith('/tabs/credentials')) {
          if (this.authService.isLoggedIn()) {
            this.router.navigateByUrl(appRelative);
          } else {
            sessionStorage.setItem(PENDING_DEEP_LINK_KEY, appRelative);
          }
        }
        break;
      }

      default:
        break;
    }
  }

  private renderDuplicateTabMessage(isDeepLink: boolean): void {
    // Cancel any pending auth operations so this follower tab cannot corrupt shared
    // storage state.
    this.authService.dispose();
    this.channel?.close();
    this.channel = null;

    // Adapt copy depending on whether this is a browser tab or the installed PWA.
    // iOS Safari PWAs expose navigator.standalone instead of display-mode:standalone.
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true;
    const typeKey = isStandalone ? 'single-instance.type-window' : 'single-instance.type-tab';
    const type = this.translate.instant(typeKey);
    const params = { type };

    const title = this.translate.instant(
      isDeepLink ? 'single-instance.title-deep-link' : 'single-instance.title-already-open'
    );
    const subtitle = this.translate.instant(
      isDeepLink ? 'single-instance.subtitle-deep-link' : 'single-instance.subtitle-already-open',
      params
    );
    const hint = this.translate.instant(
      isStandalone ? 'single-instance.hint-standalone' : 'single-instance.hint-tab'
    );
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
