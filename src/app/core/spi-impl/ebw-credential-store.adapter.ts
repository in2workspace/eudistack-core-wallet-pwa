import { Injectable } from '@angular/core';
import {VerifiableCredential} from "../models/verifiable-credential";

/**
 * Adapter for the server mode (EBW - Enterprise Backend Wallet).
 * Currently implemented as a stub until EBW integration is available.
 */
@Injectable({
  providedIn: 'root'
})
export class EbwCredentialStoreAdapter {

  async saveCredentials(credentials: VerifiableCredential[]): Promise<void> {
    console.warn('[EbwCredentialStoreAdapter] saveCredentials is a stub. Delegating to EBW not yet implemented.');
  }
}
