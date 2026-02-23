
import { AppError } from "src/app/interfaces/error/AppError";


export type Oid4vciErrorCode = 'unknown' | 'user_cancelled';

export class Oid4vciError extends AppError {
  public override readonly code: Oid4vciErrorCode;

  constructor(
    message: string,
    opts?: { userMessage?: string; code?: Oid4vciErrorCode; cause?: unknown }
  ) {
    super(message, opts);
    this.code = (opts?.code ?? 'unknown') as Oid4vciErrorCode;
  }
}