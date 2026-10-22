import { HttpErrorResponse } from '@angular/common/http';
import { AppError } from 'src/app/core/models/error/AppError';
import { parseApiError } from 'src/app/core/models/error/ApiError';

/**
 * Error codes of the Wallet Unit Service registration and access API
 * (EUD-8 `annex/openapi.yaml`). They travel in the `type` of an RFC 9457 body.
 */
export const AUTH_PROBLEM_TYPE = {
  INVALID_REQUEST: 'invalid_request',
  INVALID_CODE: 'invalid_code',
  EXPIRED_CODE: 'expired_code',
  TOO_MANY_ATTEMPTS: 'too_many_attempts',
  INVALID_TICKET: 'invalid_ticket',
  REGISTRATION_FAILED: 'registration_failed',
  PASSKEY_PRF_UNSUPPORTED: 'passkey_prf_unsupported',
  UNKNOWN_CREDENTIAL: 'unknown_credential',
  AUTHENTICATION_FAILED: 'authentication_failed',
  INVALID_SESSION: 'invalid_session',
  RATE_LIMITED: 'rate_limited',
} as const;

/** Outcomes of a passkey ceremony against the service that the access screen shows differently. */
export type WalletAuthFailure =
  | 'unknown_credential'
  | 'authentication_failed'
  | 'passkey_prf_unsupported'
  | 'registration_failed'
  | 'invalid_ticket';

/** A passkey registration or sign-in the Wallet Unit Service refused, or a PRF check that failed. */
export class WalletAuthError extends AppError {
  public readonly failure: WalletAuthFailure;

  public constructor(failure: WalletAuthFailure, cause?: unknown) {
    super(`Wallet access failed: ${failure}`, { cause });
    this.failure = failure;
  }
}

/**
 * Error code of a failed call to the Wallet Unit Service: the RFC 9457 `type`,
 * or its last segment when the service sends it as a URI. Falls back to the
 * `{ error }` body the service used before the RFC 9457 migration, so the
 * Wallet App works against both while the two are deployed together.
 */
export function authProblemType(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const problem = parseApiError(err.error);
  if (problem) {
    const segments = problem.type.split(/[/:#]/).filter(segment => segment !== '');
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }
  const legacy = (err.error as { error?: unknown } | null)?.error;
  return typeof legacy === 'string' ? legacy : null;
}
