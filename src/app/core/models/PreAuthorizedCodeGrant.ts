export interface PreAuthorizedCodeGrant {
  userPinRequired: boolean;
  preAuthorizedCode: string;
  txCode?: CredentialOfferTxCode | null;
}

export interface CredentialOfferTxCode {
  inputMode?: string;
  length?: number;
  description?: string;
}