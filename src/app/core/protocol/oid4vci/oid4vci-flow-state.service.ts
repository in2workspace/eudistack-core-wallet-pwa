import { Injectable } from '@angular/core';
import { IssuanceProfile } from './issuance-profile.util';

const STORAGE_KEY = 'oid4vci_auth_flow_state';

export interface Oid4vciAuthFlowState {
  credentialOfferUri: string;
  codeVerifier: string;
  state: string;
  redirectUri: string;
  profile: IssuanceProfile;
}

@Injectable({ providedIn: 'root' })
export class Oid4vciFlowStateService {
  save(state: Oid4vciAuthFlowState): void {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  restore(): Oid4vciAuthFlowState | null {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(STORAGE_KEY);
    try {
      return JSON.parse(raw) as Oid4vciAuthFlowState;
    } catch {
      return null;
    }
  }

  clear(): void {
    sessionStorage.removeItem(STORAGE_KEY);
  }
}
