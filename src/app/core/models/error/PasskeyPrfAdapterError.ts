import { AppError } from './AppError';

export type PasskeyPrfAdapterErrorCode = 'wrap_unavailable_on_this_device' | 'prepare_sign_failed' | 'prf_unavailable';

export class PasskeyPrfAdapterError extends AppError {
  public override readonly code: PasskeyPrfAdapterErrorCode;

  constructor(
    message: string,
    opts?: {
      code?: PasskeyPrfAdapterErrorCode;
      cause?: unknown;
      translationKey?: string;
      translationParams?: Record<string, unknown>;
    }
  ) {
    super(message, opts);
    this.code = opts?.code ?? 'prepare_sign_failed';
  }
}
