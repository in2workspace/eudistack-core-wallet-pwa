import { Injectable, OnDestroy, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

interface SingleInstanceMessage {
  type: 'NEW_TAB' | 'LEADER_ACK' | 'NAVIGATE';
  tabId: string;
  url?: string;
}

const CHANNEL_NAME = 'wallet-single-instance';
const ELECTION_TIMEOUT_MS = 300;

@Injectable({ providedIn: 'root' })
export class SingleInstanceService implements OnDestroy {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  private channel: BroadcastChannel | null = null;
  private readonly tabId = crypto.randomUUID();
  private isLeader = false;

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
    const windowOrTab = isStandalone ? 'ventana' : 'pestaña';

    const title = isDeepLink
      ? 'Credencial enviada a EUDI Wallet'
      : 'EUDI Wallet ya está abierto';
    const subtitle = isDeepLink
      ? `La credencial se ha enviado a la ${windowOrTab} activa de EUDI Wallet. Puedes cerrar esta ${windowOrTab}.`
      : `Ya tienes EUDI Wallet abierto en otra ${windowOrTab}. Puedes cerrar esta.`;
    const hint = isStandalone
      ? 'Vuelve a la otra ventana de EUDI Wallet.'
      : 'Usa Ctrl+Tab para volver a la pestaña activa.';
    const closeFallback = isStandalone
      ? 'Cierra esta ventana manualmente'
      : 'Cierra esta pestaña con Ctrl+W (⌘+W en Mac)';

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
          Cerrar esta ${windowOrTab}
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
