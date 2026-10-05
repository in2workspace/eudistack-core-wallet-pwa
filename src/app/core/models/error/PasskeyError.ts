import { AppError } from 'src/app/core/models/error/AppError';

export type PasskeyCeremony = 'get' | 'create';

export type PasskeyErrorCode =
  | 'passkey_cancelled'
  | 'passkey_timeout'
  | 'passkey_already_registered'
  | 'passkey_not_supported'
  | 'passkey_security'
  | 'passkey_failed';

/**
 * Browsers report cancel and timeout with the same `NotAllowedError` on purpose
 * (WebAuthn §14.5.2 privacy), so a timeout can only be inferred from how long
 * the ceremony ran against the `timeout` we asked for. The margin absorbs the
 * gap between the browser's internal timer and ours.
 */
const TIMEOUT_MARGIN_MS = 2_000;

const TRANSLATION_KEYS: Record<PasskeyErrorCode, string> = {
  passkey_cancelled: 'auth.errors.passkey-login-cancelled',
  passkey_timeout: 'auth.errors.passkey-timeout',
  passkey_already_registered: 'auth.errors.passkey-already-registered',
  passkey_not_supported: 'auth.errors.passkey-not-supported',
  passkey_security: 'auth.errors.passkey-security',
  passkey_failed: 'auth.errors.passkey-failed',
};

/** A failed WebAuthn ceremony, classified so the UI can tell user actions from real faults. */
export class PasskeyError extends AppError {
  public override readonly code: PasskeyErrorCode;
  public readonly ceremony: PasskeyCeremony;

  public constructor(code: PasskeyErrorCode, ceremony: PasskeyCeremony, cause?: unknown) {
    super(`WebAuthn ${ceremony} failed: ${code}`, {
      code,
      cause,
      translationKey: code === 'passkey_cancelled' && ceremony === 'create'
        ? 'auth.errors.passkey-creation-cancelled'
        : TRANSLATION_KEYS[code],
    });
    this.code = code;
    this.ceremony = ceremony;
  }

  /** Cancel and timeout are normal user outcomes: show a notice, never log them as errors. */
  public get isUserAbort(): boolean {
    return this.code === 'passkey_cancelled' || this.code === 'passkey_timeout';
  }
}

/**
 * Maps whatever `navigator.credentials.get/create` rejected with to a PasskeyError.
 * `timeoutMs` is the `timeout` passed to the ceremony; omit it when none was set.
 */
export function toPasskeyError(
  error: unknown,
  ceremony: PasskeyCeremony,
  elapsedMs: number,
  timeoutMs?: number
): PasskeyError {
  if (error instanceof PasskeyError) return error;

  switch (domExceptionName(error)) {
    case 'NotAllowedError': {
      const timedOut = timeoutMs !== undefined && elapsedMs >= timeoutMs - TIMEOUT_MARGIN_MS;
      return new PasskeyError(timedOut ? 'passkey_timeout' : 'passkey_cancelled', ceremony, error);
    }
    case 'AbortError':
      return new PasskeyError('passkey_cancelled', ceremony, error);
    case 'InvalidStateError':
      return new PasskeyError(
        ceremony === 'create' ? 'passkey_already_registered' : 'passkey_failed',
        ceremony,
        error
      );
    case 'NotSupportedError':
    case 'ConstraintError':
      return new PasskeyError('passkey_not_supported', ceremony, error);
    case 'SecurityError':
      return new PasskeyError('passkey_security', ceremony, error);
    default:
      return new PasskeyError('passkey_failed', ceremony, error);
  }
}

// DOMException is not reliably `instanceof`-checkable across realms/polyfills: read the name.
function domExceptionName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : undefined;
}
