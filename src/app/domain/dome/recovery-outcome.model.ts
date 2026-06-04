export type RecoveryStatus = 'ok' | 'empty' | 'error';

export interface RecoveryOutcome {
  status: RecoveryStatus;
  credentials?: any[];
  message?: string;
  timestamp: string;
  idempotencyKey?: string;
}
