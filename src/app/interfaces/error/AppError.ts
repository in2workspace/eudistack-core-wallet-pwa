import { Oid4vciErrorCode } from "src/app/core/models/error/Oid4vciError";
import { retryUserMessage } from "src/app/helpers/http-error-message";

export type AppErrorCode = 'unknown' | 'warning' | Oid4vciErrorCode;

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly cause: unknown;
  public readonly userMessage: string | undefined;

  constructor(
    message: string,
    opts?: { userMessage?: string; code?: AppErrorCode; cause?: unknown }
  ) {
    super(message);
    this.code = opts?.code ?? 'unknown';
    this.cause = opts?.cause;
    this.userMessage = opts?.userMessage;
  }
}

export function throwAppError(baseMessage: string, opts?: { userBaseMessage?: string, cause?: unknown }): never {
  throw new AppError(baseMessage, {
    cause: opts?.cause,
    userMessage: retryUserMessage(opts?.userBaseMessage ?? baseMessage),
  });
}