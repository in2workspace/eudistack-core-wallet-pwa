import { HttpErrorResponse } from "@angular/common/http";
import { Oid4vciError, Oid4vciErrorCode } from "../core/models/error/Oid4vciError";

export function httpErrorMessage(e: HttpErrorResponse, message: string): string {
    if (e.status === 0) return `Network error. ${message}`;
    if (e.status === 400) return `Invalid request. ${message}`;
    if (e.status === 401 || e.status === 403) return `Not authorized. ${message}`;
    if (e.status === 404) return `Resource not found. ${message}`;
    if (e.status >= 500) return `Server error. ${message}`;
    return `Unexpected error. ${message}`;
}

export function retryUserMessage(base: string): string {
  return `${base}. Try again.`;
}

export function wrapOid4vciHttpError(
  e: unknown,
  baseMessage: string,
  opts?: {
    code?: Oid4vciErrorCode;
    mapHttpToCode?: (http: HttpErrorResponse) => Oid4vciErrorCode | undefined;
    userMessage?: string;
    mapHttpToUserMessage?: (http: HttpErrorResponse) => string | undefined;
  }
): never {
  // If it's already your domain error, keep it as-is
  if (e instanceof Oid4vciError) throw e;

  // Default: show userMessage if provided, otherwise fall back to baseMessage
  const fallbackUserMessage = opts?.userMessage ?? baseMessage;

  if (e instanceof HttpErrorResponse) {
    const mappedCode = opts?.mapHttpToCode?.(e);
    const mappedUserMessage = opts?.mapHttpToUserMessage?.(e);

    throw new Oid4vciError(httpErrorMessage(e, baseMessage), {
      code: mappedCode ?? opts?.code,
      cause: e,
      userMessage: mappedUserMessage ?? fallbackUserMessage,
    });
  }

  throw new Oid4vciError(baseMessage, {
    code: opts?.code,
    cause: e,
    userMessage: fallbackUserMessage,
  });
}