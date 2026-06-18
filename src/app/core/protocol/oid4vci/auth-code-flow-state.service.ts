import { Injectable } from '@angular/core';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { CredentialIssuerMetadata } from '../../models/dto/CredentialIssuerMetadata';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { IssuanceProfile } from './issuance-profile.util';

export interface AuthCodePendingState {
  credentialOffer: CredentialOffer;
  credentialIssuerMetadata: CredentialIssuerMetadata;
  authServerMetadata: AuthorisationServerMetadata;
  profile: IssuanceProfile;
  codeVerifier: string;
  redirectUri: string;
  oauthState: string;
}

const STATE_KEY = 'oid4vci_auth_code_state';

@Injectable({ providedIn: 'root' })
export class AuthCodeFlowStateService {
  save(state: AuthCodePendingState): void {
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  load(): AuthCodePendingState | null {
    const raw = sessionStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as AuthCodePendingState) : null;
  }

  clear(): void {
    sessionStorage.removeItem(STATE_KEY);
  }

  has(): boolean {
    return sessionStorage.getItem(STATE_KEY) !== null;
  }
}