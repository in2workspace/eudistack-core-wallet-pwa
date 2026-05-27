import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class FeatureFlagsService {

  private get env(): any {
    return (window as any).env || {};
  }

  get isDomeAutoRecoveryEnabled(): boolean {
    return this.env.wallet?.dome?.auto_recovery?.enabled === true;
  }

  get isDomeModeServerEnabled(): boolean {
    return this.env.wallet?.dome?.mode_server === true;
  }
}
