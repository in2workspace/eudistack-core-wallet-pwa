import { Oid4vciErrorCode } from "src/app/core/models/error/Oid4vciError";

export type AppErrorCode = 'unknown' | 'warning' | Oid4vciErrorCode;

export class AppError extends Error {
  public readonly code: AppErrorCode;
  public readonly cause?: unknown;

  // UI
  public readonly translationKey?: string;
  public readonly translationParams?: Record<string, unknown>;

  constructor(
    message: string,
    opts?: {
      code?: AppErrorCode;
      cause?: unknown;
      translationKey?: string;
      translationParams?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.code = opts?.code ?? 'unknown';
    this.cause = opts?.cause;
    this.translationKey = opts?.translationKey;
    this.translationParams = opts?.translationParams;
  }
}

export function throwAppError(
  technicalMessage: string,
  opts?: { code?: AppErrorCode; translationKey?: string; cause?: unknown }
): never {
  throw new AppError(technicalMessage, {
    code: opts?.code ?? 'unknown',
    cause: opts?.cause,
    translationKey: opts?.translationKey ?? 'errors.default',
  });
}