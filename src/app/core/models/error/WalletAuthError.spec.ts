import { HttpErrorResponse } from '@angular/common/http';
import { authProblemType, noAccountSignupUrl } from './WalletAuthError';

describe('authProblemType', () => {
  it('reads the RFC 9457 type', () => {
    expect(authProblemType(new HttpErrorResponse({ status: 401, error: { type: 'unknown_credential', status: 401 } })))
      .toBe('unknown_credential');
  });

  it('reads the code at the end of a type URI', () => {
    expect(authProblemType(new HttpErrorResponse({ status: 401, error: { type: 'https://eudistack.net/problems/invalid_ticket' } })))
      .toBe('invalid_ticket');
  });

  it('falls back to the legacy { error } body', () => {
    expect(authProblemType(new HttpErrorResponse({ status: 401, error: { error: 'expired_code' } }))).toBe('expired_code');
  });

  it('returns null for anything else', () => {
    expect(authProblemType(new Error('x'))).toBeNull();
    expect(authProblemType(new HttpErrorResponse({ status: 500, error: 'oops' }))).toBeNull();
  });
});

describe('noAccountSignupUrl (EUD-315)', () => {
  const noAccount = (body: Record<string, unknown>) =>
    new HttpErrorResponse({ status: 403, error: { type: 'no_account', title: 'No wallet', status: 403, ...body } });

  it('reads the signupUrl of a no_account problem', () => {
    expect(noAccountSignupUrl(noAccount({ signupUrl: 'https://portal.example.org/' }))).toBe('https://portal.example.org/');
  });

  it('returns null without signupUrl, with a non-http(s) one, or for another problem', () => {
    expect(noAccountSignupUrl(noAccount({}))).toBeNull();
    expect(noAccountSignupUrl(noAccount({ signupUrl: 'javascript:alert(1)' }))).toBeNull();
    expect(noAccountSignupUrl(noAccount({ signupUrl: 'not a url' }))).toBeNull();
    expect(noAccountSignupUrl(new HttpErrorResponse({ status: 401, error: { type: 'invalid_code', signupUrl: 'https://x.example/' } })))
      .toBeNull();
    expect(noAccountSignupUrl(new Error('x'))).toBeNull();
  });
});
