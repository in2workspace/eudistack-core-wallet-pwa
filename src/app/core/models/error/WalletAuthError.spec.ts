import { HttpErrorResponse } from '@angular/common/http';
import { authProblemType } from './WalletAuthError';

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
