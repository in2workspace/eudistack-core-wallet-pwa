import {VerifiableCredential} from "../../core/models/verifiable-credential";

export interface SyncCredentialsRequest {
  idempotencyKey: string;
  holderKeyThumbprint: string;
}

export interface SyncCredentialsResponse {
  credentials: VerifiableCredential[];
  format: string;
}
