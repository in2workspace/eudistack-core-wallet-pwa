import { Injectable, OnDestroy, inject } from '@angular/core';
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
          this.renderDuplicateTabMessage();
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

      case 'NAVIGATE':
        if (msg.url) {
          if (msg.url !== '/') {
            sessionStorage.setItem(PENDING_DEEP_LINK_KEY, msg.url);
          }
          this.authService.forceLogout();
          window.focus();
        }
        break;

      default:
        break;
    }
  }

  private renderDuplicateTabMessage(): void {
    try {
      window.close();
    } catch {
      // window.close() only works when the tab was opened by script.
    }

    // Replace body content before Angular paints to avoid a blank/broken page.
    document.body.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100vh;font-family:sans-serif;gap:16px;color:#001E8C;text-align:center;
        padding:24px;box-sizing:border-box;">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        <h2 style="margin:0;font-size:1.25rem;">EUDI Wallet ya está abierto</h2>
        <p style="margin:0;font-size:.9rem;color:#555;max-width:320px;">
          Tu solicitud se ha enviado a la pestaña activa. Puedes cerrar esta pestaña.
        </p>
        <button onclick="window.close()" style="
          margin-top:8px;padding:10px 24px;border:none;border-radius:8px;
          background:#001E8C;color:#fff;font-size:.9rem;cursor:pointer;">
          Cerrar esta pestaña
        </button>
      </div>`;
  }

  public ngOnDestroy(): void {
    this.channel?.close();
  }
}
