export type RecoveryStatus = 'ok' | 'empty' | 'error';

export interface RecoveryOutcome {
  status: RecoveryStatus;
  message?: string;
  timestamp: string;
  idempotencyKey?: string;
}
