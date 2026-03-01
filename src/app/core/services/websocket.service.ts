import { inject, Injectable } from '@angular/core';
import { AuthService } from './auth.service';
import { AlertController, AlertOptions } from '@ionic/angular';
import { environment } from 'src/environments/environment';
import { TranslateService } from '@ngx-translate/core';
import { WEBSOCKET_NOTIFICATION_PATH } from '../constants/api.constants';
import { LoaderService } from '../../shared/services/loader.service';
import { ToastServiceHandler } from '../../shared/services/toast.service';
import { isNotificationRequest, Power, CredentialPreview } from '../models/websocket-data';

@Injectable({
  providedIn: 'root',
})
export class WebsocketService {
  private notificationSocket?: WebSocket;

  private readonly alertController = inject(AlertController);
  private readonly authService = inject(AuthService);
  public readonly loader = inject(LoaderService);
  public readonly translate = inject(TranslateService);
  private readonly toastServiceHandler = inject(ToastServiceHandler);

  private async routeMessage(data: any): Promise<void> {
    if (isNotificationRequest(data)) {
      await this.handleNotificationDecisionRequest(data);
    }
  }

  private connectSocket(
    path: string,
    assignSocket: (ws: WebSocket) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(environment.websocket_url + path);
      assignSocket(ws);

      ws.onopen = () => {
        console.log(`WebSocket connection opened: ${path}`);
        this.sendMessage(ws, JSON.stringify({ id: this.authService.getToken() }));
        resolve();
      };

      ws.onerror = (ev: Event) => {
        console.error(`WebSocket failed to open: ${path}`, ev);
        reject(new Error('Websocket error.'));
      };

      ws.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          await this.routeMessage(data);
        } catch (e) {
          console.error(`WebSocket message parse/handle error: ${path}`, e, event.data);
        }
      };

      ws.onclose = () => {
        this.loader.removeLoadingProcess();
        console.log(`WebSocket connection closed: ${path}`);
      };
    });
  }

  public connectNotificationSocket(): Promise<void> {
    return this.connectSocket(WEBSOCKET_NOTIFICATION_PATH, (ws) => (this.notificationSocket = ws));
  }

  public closeNotificationConnection(): void {
    this.safeClose(this.notificationSocket);
    this.notificationSocket = undefined;
  }

  public sendNotificationMessage(message: string): void {
    this.sendMessage(this.notificationSocket, message);
  }

  private sendMessage(socket: WebSocket | undefined, payload: string): void {
    if (!socket) {
      console.error('WebSocket is not initialized.');
      return;
    }
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(payload);
    } else {
      console.error('WebSocket connection is not open.');
    }
  }

  private safeClose(socket?: WebSocket): void {
    try {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
      }
    } catch (e) {
      console.warn('Error closing websocket', e);
    }
  }

  private startCountdown(
    alert: any,
    description: string,
    initialCounter: number
  ): number {
    let counter = initialCounter;
  
    const interval = window.setInterval(() => {

      if (counter > 0) {
        counter--;
        const message = this.translate.instant('confirmation.messageHtml', {
        description,
        counter,
    });
        alert.message = message;
      } else {
        window.clearInterval(interval);
        alert.dismiss();
      }
    }, 1000);
  
    return interval;
  }

  private async handleNotificationDecisionRequest(data: any): Promise<void> {
    let closedByUser = false;

    const counter = data.timeout || 80;

    const preview = data.credentialPreview as CredentialPreview;
    const subjectLabel = this.translate.instant('confirmation.holder');
    const organizationLabel = this.translate.instant('confirmation.organization');
    const powersLabel = this.translate.instant('confirmation.powers');
    const expirationLabel = this.translate.instant('confirmation.expiration');


    let previewHtml = '';

    if (preview) {
      previewHtml = `
        <div class="cred-preview">
          <div class="cred-row">
            <span class="cred-label"><strong>${subjectLabel}</strong>${this.escapeHtml(preview.subjectName)}</span>
          </div>

          <div class="cred-row">
            <span class="cred-label"><strong>${organizationLabel}</strong>${this.escapeHtml(preview.organization)}</span>
          </div>

          <div class="cred-row">
            <span class="cred-label"><strong>${powersLabel}</strong>${this.mapPowersToHumanReadable(preview.power)}</span>
          </div>

          <div class="cred-row">
            <span class="cred-label"><strong>${expirationLabel}</strong>${this.formatDateHuman(preview.expirationDate)}</span>
          </div>
        </div>
      `;
    }

    const header = this.translate.instant('confirmation.new-credential-title');
    const accept = this.translate.instant('confirmation.accept');
    const reject = this.translate.instant('confirmation.cancel');

    const baseDescription = this.translate.instant('confirmation.new-credential');

    const descriptionWithPreview = previewHtml
      ? `${baseDescription}<br/>${previewHtml}`
      : baseDescription;
    const message = this.translate.instant('confirmation.messageHtml', {
      description: descriptionWithPreview,
      counter: counter,
    });

    let interval: any;

    const rejectHandler = async () => {
      closedByUser = true;
      clearInterval(interval);
      this.sendNotificationMessage(JSON.stringify({ decision: 'REJECTED' }));
      Promise.resolve().then(() => this.closeNotificationConnection());
      await this.showTempOkMessage('home.rejected-msg');      
      window.location.reload();
    };

    const acceptHandler = async () => {
      closedByUser = true;
      clearInterval(interval);
      this.sendNotificationMessage(JSON.stringify({ decision: 'ACCEPTED' }));
      Promise.resolve().then(() => this.closeNotificationConnection());
      await this.showTempOkMessage('home.ok-msg');
    };

    const alertOptions: AlertOptions = {
      header,
      message,
      buttons: [
        { text: reject, role: 'cancel', handler: rejectHandler },
        { text: accept, role: 'confirm', handler: acceptHandler },
      ],
      backdropDismiss: false,
    };

    const alert = await this.alertController.create(alertOptions);
    await alert.present();
    alert.onDidDismiss().then(() => {
      clearInterval(interval);
      this.closeNotificationConnection();
      if(!closedByUser){
        this.toastServiceHandler
          .showErrorAlert("The QR session expired")
          .subscribe();        
      }
      
    });
    interval = this.startCountdown(alert, descriptionWithPreview, counter);    
  }

  private mapPowersToHumanReadable(powers: Power[]): string {
    if (powers.length === 0) return '';

    const unknown = this.translate.instant('confirmation.unknown');

    const lines = powers
      .map((p) => {
        const fnKey = this.normalizeKey(p?.function);
        const actionKeys = this.normalizeActionKeys(p?.action);

        const functionLabelRaw =
          this.getSafeTranslation(`vc-fields.power.${fnKey}`, p?.function, unknown);

        const actionLabelsRaw = actionKeys
          .map((a) => this.getSafeTranslation(`vc-fields.power.${a}`, a, unknown))
          .filter((x) => x && x !== unknown);

        const functionLabel = this.escapeHtml(functionLabelRaw);
        const actionLabels = this.escapeHtml(actionLabelsRaw.join(', '));

        if (!functionLabel || !actionLabels) return '';

        return `${functionLabel}: ${actionLabels}`;
      })
      .filter(Boolean);

    return lines.join('<br/>');
  }

  private getSafeTranslation(key: string, fallbackText: unknown, unknown: string): string {
    const translated = this.translate.instant(key);

    const hasRealTranslation = translated && translated !== key;

    if (hasRealTranslation) return String(translated);

    const fb = String(fallbackText ?? '').trim();
    const looksLikeKey = fb.includes('.') || fb.includes('_') || fb.includes('-');
    if (!fb || looksLikeKey) return unknown;

    return fb;
  }

  private normalizeKey(value: unknown): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private normalizeActionKeys(actions: unknown): string[] {
    if (!Array.isArray(actions)) return [];
    return actions
      .map((a) => this.normalizeKey(a))
      .filter(Boolean);
  }

  private async showTempOkMessage(message: string): Promise<void> {
    const alert = await this.alertController.create({
      message: `
        <div style="display: flex; align-items: center; gap: 50px;">
          <ion-icon name="checkmark-circle-outline" ></ion-icon>
          <span>${this.translate.instant(message)}</span>
        </div>
      `,
      cssClass: 'custom-alert-ok',
    });

    await alert.present();

    setTimeout(async () => {
      await alert.dismiss();

    }, 3000);
  }


  private formatDateHuman(dateStr: string): string {
    dateStr = this.escapeHtml(dateStr);
    const date = new Date(dateStr);

    return date.toLocaleDateString(
      this.translate.currentLang || 'es-ES',
      {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }
    );
  }

  private escapeHtml(value: string): string {
    let s = String(value ?? '');

    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      s = s.slice(1, -1);
    }

    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}