import { Injectable } from '@angular/core';
import { environment } from 'src/environments/environment';

@Injectable({ providedIn: 'root' })
export class UrlResolverService {
  serverUrl(): string {
    return environment.server_url || `${window.location.origin}/business-wallet`;
  }

  websocketUrl(): string {
    const wsOrigin = window.location.origin.replace(/^http/, 'ws');
    return environment.websocket_url || `${wsOrigin}/business-wallet`;
  }

}
