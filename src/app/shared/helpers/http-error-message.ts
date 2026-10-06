import { HttpErrorResponse } from "@angular/common/http";
import { Oid4vciError, Oid4vciErrorCode } from "../../core/models/error/Oid4vciError";
import { Oid4vpError, Oid4vpErrorCode } from "../../core/models/error/Oid4vpError";

export function defaultHttpToTranslationKey(http: HttpErrorResponse): string {
  if (http.status === 0) return 'errors.network-error';
  if (http.status === 400) return 'errors.invalid-request';
  if (http.status === 401 || http.status === 403) return 'errors.not-authorized';
  if (http.status === 404) return 'errors.resource-not-found';
  if (http.status === 410) return 'errors.credential-offer-already-processed';
  if (http.status >= 500) return 'errors.server-error';
  return 'errors.default';
}

/**
 * True when the verifier rejected the presentation because the credential is revoked
 * (HTTP 403 whose RFC 7807 `type` is `credential_revoked`). The body may arrive as a raw
 * string (responseType 'text') or as an already-parsed object.
 */
export function isCredentialRevokedResponse(e: unknown): boolean {
  if (!(e instanceof HttpErrorResponse) || e.status !== 403) return false;
  let body: unknown = e.error;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return false;
    }
  }
  return (body as { type?: unknown } | null)?.type === 'credential_revoked';
}

export function wrapOid4vciHttpError(
  e: unknown,
  technicalBaseMessage: string,
  opts?: {
    code?: Oid4vciErrorCode;
    translationKey?: string;
    translationParams?: Record<string, unknown>;
  }
): never {
  if (e instanceof Oid4vciError) throw e;

  if (e instanceof HttpErrorResponse) {
    const key = opts?.translationKey ?? defaultHttpToTranslationKey(e);
    const technicalMsg = `${technicalBaseMessage} (HTTP ${e.status})`;

    throw new Oid4vciError(technicalMsg, {
      code: opts?.code,
      cause: e,
      translationKey: key,
      translationParams: opts?.translationParams,
    });
  }

  throw new Oid4vciError(technicalBaseMessage, {
    code: opts?.code,
    cause: e,
    translationKey: opts?.translationKey ?? 'errors.default',
    translationParams: opts?.translationParams,
  });
}

export function wrapOid4vpHttpError(
  e: unknown,
  technicalBaseMessage: string,
  opts?: {
    code?: Oid4vpErrorCode;
    translationKey?: string;
    translationParams?: Record<string, unknown>;
  }
): never {
  if (e instanceof Oid4vpError) throw e;

  if (e instanceof HttpErrorResponse) {
    const key = opts?.translationKey ?? defaultHttpToTranslationKey(e);
    const technicalMsg = `${technicalBaseMessage} (HTTP ${e.status})`;

    throw new Oid4vpError(technicalMsg, {
      code: opts?.code,
      cause: e,
      translationKey: key,
      translationParams: opts?.translationParams,
    });
  }

  throw new Oid4vpError(technicalBaseMessage, {
    code: opts?.code,
    cause: e,
    translationKey: opts?.translationKey ?? 'errors.default',
    translationParams: opts?.translationParams,
  });
}
