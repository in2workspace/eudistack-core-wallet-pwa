import { AppError } from './AppError';
import { PasskeyError, toPasskeyError } from './PasskeyError';

function domException(name: string): DOMException {
  return new DOMException('The operation either timed out or was not allowed.', name);
}

describe('PasskeyError', () => {
  it('is an AppError so existing flows (LoaderHandledFlowService) translate it', () => {
    expect(new PasskeyError('passkey_failed', 'get')).toBeInstanceOf(AppError);
  });

  it.each([
    ['passkey_cancelled', 'get', 'auth.errors.passkey-login-cancelled'],
    ['passkey_cancelled', 'create', 'auth.errors.passkey-creation-cancelled'],
    ['passkey_timeout', 'get', 'auth.errors.passkey-timeout'],
    ['passkey_already_registered', 'create', 'auth.errors.passkey-already-registered'],
    ['passkey_not_supported', 'create', 'auth.errors.passkey-not-supported'],
    ['passkey_security', 'get', 'auth.errors.passkey-security'],
    ['passkey_failed', 'get', 'auth.errors.passkey-failed'],
  ] as const)('%s on %s uses %s', (code, ceremony, key) => {
    expect(new PasskeyError(code, ceremony).translationKey).toBe(key);
  });

  it.each([
    ['passkey_cancelled', true],
    ['passkey_timeout', true],
    ['passkey_security', false],
    ['passkey_failed', false],
  ] as const)('isUserAbort for %s is %s', (code, expected) => {
    expect(new PasskeyError(code, 'get').isUserAbort).toBe(expected);
  });
});

describe('toPasskeyError', () => {
  const TIMEOUT_MS = 60_000;

  it('classifies a quick NotAllowedError as a user cancellation', () => {
    expect(toPasskeyError(domException('NotAllowedError'), 'get', 1_500, TIMEOUT_MS).code).toBe('passkey_cancelled');
  });

  it('classifies a NotAllowedError raised at the configured timeout as a timeout', () => {
    expect(toPasskeyError(domException('NotAllowedError'), 'get', 59_000, TIMEOUT_MS).code).toBe('passkey_timeout');
  });

  it('cannot infer a timeout when the ceremony set none', () => {
    expect(toPasskeyError(domException('NotAllowedError'), 'get', 300_000).code).toBe('passkey_cancelled');
  });

  it('classifies AbortError as a cancellation', () => {
    expect(toPasskeyError(domException('AbortError'), 'get', 10, TIMEOUT_MS).code).toBe('passkey_cancelled');
  });

  it('classifies InvalidStateError on create as an already-registered authenticator', () => {
    expect(toPasskeyError(domException('InvalidStateError'), 'create', 10).code).toBe('passkey_already_registered');
  });

  it('classifies InvalidStateError on get as a generic failure', () => {
    expect(toPasskeyError(domException('InvalidStateError'), 'get', 10).code).toBe('passkey_failed');
  });

  it.each(['NotSupportedError', 'ConstraintError'])('classifies %s as not supported', (name) => {
    expect(toPasskeyError(domException(name), 'create', 10).code).toBe('passkey_not_supported');
  });

  it('classifies SecurityError (RP ID / origin / insecure context) as a security failure', () => {
    expect(toPasskeyError(domException('SecurityError'), 'get', 10).code).toBe('passkey_security');
  });

  it.each([
    ['an unknown DOMException', domException('UnknownError')],
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['an object with a non-string name', { name: 42 }],
  ])('classifies %s as a generic failure', (_label, error) => {
    expect(toPasskeyError(error, 'get', 10).code).toBe('passkey_failed');
  });

  it('keeps the original error as cause for debugging', () => {
    const original = domException('SecurityError');
    expect(toPasskeyError(original, 'get', 10).cause).toBe(original);
  });

  it('returns an existing PasskeyError untouched', () => {
    const existing = new PasskeyError('passkey_timeout', 'get');
    expect(toPasskeyError(existing, 'get', 10)).toBe(existing);
  });
});
