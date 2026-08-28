import { AppError } from './AppError';

export type HybridAdapterErrorCode = 'wrap_unavailable_on_this_device' | 'prepare_sign_failed';

export class HybridAdapterError extends AppError {
  public override readonly code: HybridAdapterErrorCode;

  constructor(
    message: string,
    opts?: {
      code?: HybridAdapterErrorCode;
      cause?: unknown;
      translationKey?: string;
      translationParams?: Record<string, unknown>;
    }
  ) {
    super(message, opts);
    this.code = opts?.code ?? 'prepare_sign_failed';
  }
}
