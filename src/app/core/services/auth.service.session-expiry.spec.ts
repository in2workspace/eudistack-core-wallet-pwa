import { TestBed } from '@angular/core/testing';
import { RemoteAuthService } from './auth.service';
import { answerStartupRefresh, AUTH_BASE, AuthHarness, createAuthHarness, session, settle } from './auth.service.testing';

const TOKEN_LIFETIME_S = 300;
const RENEW_AT_MS = (TOKEN_LIFETIME_S - 30) * 1000;

/**
 * Activity-based renewal (EUD-8 design §2.4, FR-18, FR-19): the access token is
 * renewed 30 s before it expires only if there has been activity since the
 * last renewal; otherwise it is left to expire and the next activity renews it,
 * and the service decides whether the session is still alive.
 */
describe('RemoteAuthService — activity-based renewal', () => {
  let harness: AuthHarness;
  let service: RemoteAuthService;

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
    harness = createAuthHarness();
    service = harness.service;
    await answerStartupRefresh(harness, session({ expiresIn: TOKEN_LIFETIME_S }));
  });

  afterEach(() => {
    service.dispose();
    harness.http.verify();
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  async function advance(ms: number): Promise<void> {
    jest.advanceTimersByTime(ms);
    await settle();
  }

  it('renews 30 s before expiry when the user was active since the last renewal', async () => {
    await advance(60_000);
    harness.activity$.next();

    await advance(RENEW_AT_MS - 60_000);

    harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'renewed' }));
    await settle();
    expect(service.getToken()).toBe('renewed');
  });

  it('keeps renewing while the activity goes on, past the token lifetime (AC-13)', async () => {
    for (let round = 0; round < 4; round++) {
      await advance(10_000);
      harness.activity$.next();
      await advance(RENEW_AT_MS - 10_000);
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: `round-${round}` }));
      await settle();
    }

    expect(service.isLoggedIn()).toBe(true);
    expect(service.getToken()).toBe('round-3');
  });

  it('counts API calls as activity', async () => {
    await advance(60_000);
    service.recordActivity();

    await advance(RENEW_AT_MS - 60_000);

    harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());
    await settle();
  });

  it('lets the token expire without activity, and stays on the wallet (the service owns the inactivity limit)', async () => {
    await advance(RENEW_AT_MS);
    harness.http.expectNone(`${AUTH_BASE}/refresh`);

    await advance(30_000);

    expect(service.getToken()).toBe('');
    expect(service.isLoggedIn()).toBe(true);
    expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('renews on the next activity after the token expired, when the session is still alive (AC-14)', async () => {
    await advance(TOKEN_LIFETIME_S * 1000);
    expect(service.getToken()).toBe('');

    harness.activity$.next();
    await settle();

    harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'back' }));
    await settle();
    expect(service.getToken()).toBe('back');
  });

  it('goes to the access screen with the expired notice when the next activity finds the session over (AC-15)', async () => {
    await advance(TOKEN_LIFETIME_S * 1000);

    harness.activity$.next();
    await settle();
    harness.http.expectOne(`${AUTH_BASE}/refresh`)
      .flush({ type: 'invalid_session', status: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(service.isLoggedIn()).toBe(false);
    expect(harness.router.navigateByUrl).toHaveBeenCalledWith('/auth/access');
    expect(service.consumeSessionExpiredNotice()).toBe(true);
    expect(harness.sessionData.sessionEnded).toHaveBeenCalled();
  });

  it('ends the session when a renewal hits the maximum duration, even with activity (AC-16)', async () => {
    await advance(10_000);
    harness.activity$.next();
    await advance(RENEW_AT_MS - 10_000);

    harness.http.expectOne(`${AUTH_BASE}/refresh`)
      .flush({ type: 'invalid_session', status: 401 }, { status: 401, statusText: 'Unauthorized' });
    await settle();

    expect(service.isLoggedIn()).toBe(false);
    expect(service.consumeSessionExpiredNotice()).toBe(true);
  });

  it('ignores activity once signed out', async () => {
    service.forceLogout();

    harness.activity$.next();
    await settle();

    harness.http.expectNone(`${AUTH_BASE}/refresh`);
  });

  it('stops the timers when disposed', async () => {
    harness.activity$.next();
    service.dispose();

    await advance(TOKEN_LIFETIME_S * 1000);

    harness.http.expectNone(`${AUTH_BASE}/refresh`);
  });
});
