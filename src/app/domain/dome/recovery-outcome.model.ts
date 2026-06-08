import {VerifiableCredential} from "../../core/models/verifiable-credential";

export type RecoveryStatus = 'ok' | 'empty' | 'error';

export interface RecoveryOutcome {
  status: RecoveryStatus;
  credentials?: VerifiableCredential[];
  message?: string;
  timestamp: string;
  idempotencyKey?: string;
}
