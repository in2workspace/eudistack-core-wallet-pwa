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
  clientMetadata?: ClientMetadata;
}

export interface ClientMetadata {
  client_name: string;
  logo_uri: string;
  client_uri: string;
  policy_uri: string;
  tos_uri: string;
  contacts: string[];
  [key: string]: any;
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
