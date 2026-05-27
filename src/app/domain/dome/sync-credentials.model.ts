export interface SyncCredentialsRequest {
  idempotencyKey: string;
  holderKeyThumbprint: string;
}

export interface SyncCredentialsResponse {
  credentials: any[];
  format: string;
}
