export interface AuthorizationRequestOID4VP {
  scope?: string[];
  responseType: string;
  responseMode: string;
  clientId: string;
  clientIdScheme?: string;
  state: string;
  nonce: string;
  responseUri: string;
  dcqlQuery?: DcqlQuery;
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}

export interface DcqlCredentialQuery {
  id: string;
  format: string;
  meta?: Record<string, unknown>;
  claims?: DcqlClaimQuery[];
}

export interface DcqlClaimQuery {
  path: string[];
  values?: unknown[];
}
