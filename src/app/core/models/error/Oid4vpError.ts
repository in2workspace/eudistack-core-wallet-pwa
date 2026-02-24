import { AppError } from 'src/app/interfaces/error/AppError';

export type Oid4vpErrorCode = 'unknown' | 'user_cancelled';

export class Oid4vpError extends AppError {
  public override readonly code: Oid4vpErrorCode;

  constructor(
    message: string,
    opts?: {
      code?: Oid4vpErrorCode;
      cause?: unknown;
      translationKey?: string;
      translationParams?: Record<string, unknown>;
    }
  ) {
    super(message, opts);
    this.code = opts?.code ?? 'unknown';
  }
}