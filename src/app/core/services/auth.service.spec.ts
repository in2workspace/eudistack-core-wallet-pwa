import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, of } from 'rxjs';
import { AuthService, isRefreshTokenRejected, RemoteAuthService, SESSION_REFRESH_LOCK } from './auth.service';
import { AUTH_SERVICE_PROVIDER } from './auth-service.provider';
import { LocalAuthService } from './local-auth.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { RegistrationTicketService } from './registration-ticket.service';
import { SessionPasskeyService } from './session-passkey.service';
import {
  accessToken,
  answerStartupRefresh,
  AUTH_BASE,
  AuthHarness,
  BroadcastChannelMock,
  createAuthHarness,
  passkeySession,
  session,
  settle,
} from './auth.service.testing';

describe('RemoteAuthService (EUD-8)', () => {
  let harness: AuthHarness;
  let service: RemoteAuthService;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    harness = createAuthHarness();
    service = harness.service;
  });

  afterEach(() => {
    service.dispose();
    harness.http.verify();
    TestBed.resetTestingModule();
  });

  describe('start-up resume (FR-19)', () => {
    it('continues the session of the refresh cookie and loads its attestations', async () => {
      const resumed = service.resumeSession();
      await answerStartupRefresh(harness, session());

      expect(await resumed).toBe(true);
      expect(service.isLoggedIn()).toBe(true);
      expect(service.getToken()).toBe(accessToken());
      expect(harness.sessionData.sessionStarted).toHaveBeenCalled();
      expect(await firstValueFrom(service.getName$())).toBe('ana@example.com');
    });

    it('marks the service initialized only once the attempt has settled', async () => {
      const initialized: boolean[] = [];
      service.isInitialized$().subscribe(value => initialized.push(value));

      await answerStartupRefresh(harness, session());

      expect(initialized).toEqual([false, true]);
    });

    it('leaves the user signed out when there is no session, and drops the local attestations of the ended one', async () => {
      const resumed = service.resumeSession();
      await answerStartupRefresh(harness, 'rejected');

      expect(await resumed).toBe(false);
      expect(service.isLoggedIn()).toBe(false);
      expect(harness.sessionData.sessionEnded).toHaveBeenCalled();
      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('retries a temporary failure before showing the access screen, without dropping the attestations', async () => {
      const resumed = service.resumeSession();
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).error(new ProgressEvent('offline'), { status: 0 });
      await settle();

      window.dispatchEvent(new Event('online'));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());

      expect(await resumed).toBe(true);
      expect(harness.sessionData.sessionEnded).not.toHaveBeenCalled();
    });

    it('gives up after the retry but resumes in the background when the connection returns', async () => {
      const resumed = service.resumeSession();
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush('down', { status: 503, statusText: 'Unavailable' });
      await settle();
      window.dispatchEvent(new Event('online'));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush('down', { status: 503, statusText: 'Unavailable' });

      expect(await resumed).toBe(false);
      expect(harness.sessionData.sessionEnded).not.toHaveBeenCalled();

      (harness.router as unknown as { url: string }).url = '/auth/access';
      window.dispatchEvent(new Event('online'));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());
      await settle();

      expect(service.isLoggedIn()).toBe(true);
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials');
    });

    it('decodes a non-ASCII email claim as UTF-8', async () => {
      const payload = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ email: 'núria@exemple.cat' }))))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await answerStartupRefresh(harness, session({ accessToken: `h.${payload}.s` }));

      expect(await firstValueFrom(service.getName$())).toBe('núria@exemple.cat');
    });

    it('sends the renewal with no body: the refresh token travels only in the cookie', async () => {
      await settle();
      const request = harness.http.expectOne(`${AUTH_BASE}/refresh`);

      expect(request.request.method).toBe('POST');
      expect(request.request.body).toBeNull();
      request.flush(session());
      await settle();
    });

    it('never stores a token in localStorage or sessionStorage', async () => {
      await answerStartupRefresh(harness, session());

      expect(localStorage.length).toBe(0);
      expect(sessionStorage.length).toBe(0);
    });
  });

  describe('renewal', () => {
    beforeEach(async () => answerStartupRefresh(harness, 'rejected'));

    it('shares one renewal between concurrent callers in the tab', async () => {
      const first = firstValueFrom(service.refreshAccessToken());
      const second = firstValueFrom(service.refreshAccessToken());
      await settle();

      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    });

    it('serializes renewals across tabs with a Web Lock, so the same cookie is never presented twice', async () => {
      // Exclusive lock shared by two tabs: the second renewal only starts once the first one settled.
      let queue: Promise<unknown> = Promise.resolve();
      const request = jest.fn((_name: string, callback: () => Promise<unknown>) => {
        const run = queue.then(() => callback());
        queue = run.catch(() => undefined);
        return run;
      });
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
      const otherTab = TestBed.runInInjectionContext(() => new RemoteAuthService());
      try {
        await settle();
        harness.http.expectOne(`${AUTH_BASE}/refresh`).flush({ type: 'invalid_session' }, { status: 401, statusText: 'Unauthorized' });
        await settle();

        const first = firstValueFrom(service.refreshAccessToken());
        const second = firstValueFrom(otherTab.refreshAccessToken());
        await settle();
        const firstRequest = harness.http.match(`${AUTH_BASE}/refresh`);
        expect(firstRequest).toHaveLength(1);

        firstRequest[0].flush(session({ accessToken: 'first' }));
        await first;
        await settle();
        harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'second' }));
        await second;

        expect(request).toHaveBeenCalledWith(SESSION_REFRESH_LOCK, expect.any(Function));
        expect(otherTab.getToken()).toBe('second');
      } finally {
        otherTab.dispose();
        delete (navigator as unknown as { locks?: unknown }).locks;
      }
    });

    it('backs background renewals off after a temporary failure (no request storm offline)', async () => {
      service['applySession'](session());
      service['accessToken'] = null;

      service.recordActivity();
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).error(new ProgressEvent('offline'), { status: 0 });
      await settle();

      service.recordActivity();
      service.recordActivity();
      await settle();
      harness.http.expectNone(`${AUTH_BASE}/refresh`);

      window.dispatchEvent(new Event('online'));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());
      await settle();
      expect(service.getToken()).toBe(accessToken());
    });

    it('a rejected renewal of a signed-in user goes to the access screen with the session-expired notice (FR-18)', async () => {
      service['applySession'](session());
      const renewal = firstValueFrom(service.refreshAccessToken()).catch(err => err);
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`)
        .flush({ type: 'invalid_session', status: 401 }, { status: 401, statusText: 'Unauthorized' });

      expect(await renewal).toBeInstanceOf(HttpErrorResponse);
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith('/auth/access');
      expect(service.consumeSessionExpiredNotice()).toBe(true);
      expect(service.consumeSessionExpiredNotice()).toBe(false);
    });

    it('a rejected renewal while signed out shows no expired notice and does not navigate', async () => {
      const renewal = firstValueFrom(service.refreshAccessToken()).catch(err => err);
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`)
        .flush({ type: 'invalid_session', status: 401 }, { status: 401, statusText: 'Unauthorized' });
      await renewal;

      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
      expect(service.consumeSessionExpiredNotice()).toBe(false);
    });

    it('a transient failure (offline) keeps the session', async () => {
      service['applySession'](session());
      const renewal = firstValueFrom(service.refreshAccessToken()).catch(err => err);
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).error(new ProgressEvent('offline'), { status: 0 });
      await renewal;

      expect(service.isLoggedIn()).toBe(true);
      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('email verification (FR-03, FR-16)', () => {
    beforeEach(async () => answerStartupRefresh(harness, 'rejected'));

    it('asks for a code with the email only', async () => {
      const sent = firstValueFrom(service.requestEmailCode('ana@example.com'));
      const request = harness.http.expectOne(`${AUTH_BASE}/register`);
      request.flush(null, { status: 202, statusText: 'Accepted' });
      await sent;

      expect(request.request.body).toEqual({ email: 'ana@example.com' });
    });

    it('keeps the registration ticket in memory and opens no session', async () => {
      const verified = firstValueFrom(service.verifyEmailCode('ana@example.com', '123456'));
      harness.http.expectOne(`${AUTH_BASE}/verify-email`)
        .flush({ registrationTicket: 'rt_1', expiresIn: 300, hasPasskeys: true });

      expect(await verified).toEqual({ hasPasskeys: true });
      expect(TestBed.inject(RegistrationTicketService).get()).toBe('rt_1');
      expect(service.isLoggedIn()).toBe(false);
      expect(service.getToken()).toBe('');
      expect(localStorage.length + sessionStorage.length).toBe(0);
    });

    it('forgets the ticket when leaving the email flow', () => {
      TestBed.inject(RegistrationTicketService).set('rt_1', 300);

      service.leaveEmailFlow();

      expect(TestBed.inject(RegistrationTicketService).get()).toBeNull();
    });
  });

  describe('sessions opened with a verified passkey', () => {
    beforeEach(async () => answerStartupRefresh(harness, 'rejected'));

    it('opens the session bound to the passkey, consumes the ticket and loads the attestations (FR-15)', async () => {
      TestBed.inject(RegistrationTicketService).set('rt_1', 300);
      harness.ceremony.signIn.mockResolvedValue(passkeySession());

      await service.signInWithPasskey();

      expect(service.isLoggedIn()).toBe(true);
      expect(TestBed.inject(SessionPasskeyService).passkeyId()).toBe('pk-1');
      expect(TestBed.inject(RegistrationTicketService).get()).toBeNull();
      expect(harness.sessionData.sessionStarted).toHaveBeenCalled();
    });

    it('signals the accepted passkeys and the account email to the passkey manager (FR-17)', async () => {
      harness.ceremony.signIn.mockResolvedValue(passkeySession());

      await service.signInWithPasskey();
      await settle();

      expect(harness.webAuthn.signalAllAcceptedCredentials)
        .toHaveBeenCalledWith('sandbox.stg.eudistack.net', 'dXNlcg', ['cred-1']);
      expect(harness.webAuthn.signalCurrentUserDetails)
        .toHaveBeenCalledWith('sandbox.stg.eudistack.net', 'dXNlcg', 'ana@example.com');
    });

    it('does not signal the accepted passkeys when the list does not contain the session passkey', async () => {
      harness.passkeyApi.listPasskeys.mockReturnValue(of([{ id: 'pk-other', credentialId: 'cred-other' }]));
      harness.ceremony.signIn.mockResolvedValue(passkeySession());

      await service.signInWithPasskey();
      await settle();

      expect(harness.webAuthn.signalAllAcceptedCredentials).not.toHaveBeenCalled();
      expect(harness.webAuthn.signalCurrentUserDetails).toHaveBeenCalled();
    });

    it('registers a new passkey and opens the session with it', async () => {
      harness.ceremony.register.mockResolvedValue(passkeySession({ credentialId: 'cred-new' }));

      await service.registerPasskey('Mac');

      expect(harness.ceremony.register).toHaveBeenCalledWith('Mac');
      expect(service.isLoggedIn()).toBe(true);
    });

    it('opens no session when the ceremony fails', async () => {
      harness.ceremony.signIn.mockRejectedValue(new Error('rejected'));

      await expect(service.signInWithPasskey()).rejects.toThrow('rejected');
      expect(service.isLoggedIn()).toBe(false);
    });

    it('ends every other session of the account (FR-11)', async () => {
      const ended = firstValueFrom(service.endOtherSessions(), { defaultValue: undefined });
      const request = harness.http.expectOne(`${AUTH_BASE}/sessions/others`);
      request.flush(null, { status: 204, statusText: 'No Content' });
      await ended;

      expect(request.request.method).toBe('DELETE');
    });
  });

  describe('logout (FR-20)', () => {
    beforeEach(async () => answerStartupRefresh(harness, session()));

    it('ends the session in the service, then locally', async () => {
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      const request = harness.http.expectOne(`${AUTH_BASE}/sessions/current`);
      expect(request.request.method).toBe('DELETE');
      request.flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(service.isLoggedIn()).toBe(false);
      expect(service.getToken()).toBe('');
      expect(harness.sessionData.sessionEnded).toHaveBeenCalled();
    });

    it('still closes the session locally when the service cannot be reached', async () => {
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).error(new ProgressEvent('offline'), { status: 0 });
      await done;

      expect(service.isLoggedIn()).toBe(false);
    });

    it('renews an access token left to expire before ending the session', async () => {
      service['accessToken'] = null;

      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(service.isLoggedIn()).toBe(false);
    });

    it('discards a renewal still in flight when the user logs out (M1)', async () => {
      service['accessToken'] = null;
      const renewal = firstValueFrom(service.refreshAccessToken()).catch(err => err);
      await settle();

      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      await settle();
      // Without Web Locks in the test both renewals are pending: the one in flight, and the
      // logout's own (the token was missing).
      const [inFlight, forLogout] = harness.http.match(`${AUTH_BASE}/refresh`);
      inFlight.flush(session({ accessToken: 'late' }));
      await settle();

      expect((await renewal).constructor.name).toBe('SessionChangedError');
      expect(service.isLoggedIn()).toBe(false);
      expect(service.getToken()).toBe('');
      forLogout.flush(session({ accessToken: 'for-logout' }));
      await settle();
      const end = harness.http.expectOne(`${AUTH_BASE}/sessions/current`);
      expect(end.request.headers.get('Authorization')).toBe('Bearer for-logout');
      end.flush(null, { status: 204, statusText: 'No Content' });
      await done;
    });

    it('renews a token about to expire before ending the session (M2)', async () => {
      service['accessTokenExpiresAt'] = Date.now() + 5_000;

      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'fresh' }));
      await settle();
      const end = harness.http.expectOne(`${AUTH_BASE}/sessions/current`);
      expect(end.request.headers.get('Authorization')).toBe('Bearer fresh');
      end.flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(service.serverLogoutPending()).toBe(false);
    });

    it('on a 401 renews once, without the expired notice, and retries ending the session (M2)', async () => {
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush({ type: 'invalid_session' }, { status: 401, statusText: 'Unauthorized' });
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'fresh' }));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(service.serverLogoutPending()).toBe(false);
      expect(service.consumeSessionExpiredNotice()).toBe(false);
      expect(harness.router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('counts a session the service no longer holds as ended', async () => {
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush({ type: 'invalid_session' }, { status: 401, statusText: 'Unauthorized' });
      await done;

      expect(service.serverLogoutPending()).toBe(false);
    });

    it('does not pretend the session closed when the service cannot be reached, and retries when back online (M2)', async () => {
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).error(new ProgressEvent('offline'), { status: 0 });
      await done;

      expect(service.isLoggedIn()).toBe(false);
      expect(service.serverLogoutPending()).toBe(true);
      expect(localStorage.getItem('wallet_server_logout_pending')).toBe('1');

      window.dispatchEvent(new Event('online'));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'fresh' }));
      await settle();
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 204, statusText: 'No Content' });
      await settle();

      expect(service.serverLogoutPending()).toBe(false);
      expect(localStorage.getItem('wallet_server_logout_pending')).toBeNull();
    });

    it('takes the other tabs of the container to the access screen too', async () => {
      const otherTab = new BroadcastChannelMock('auth');

      const posted = jest.spyOn(BroadcastChannelMock.prototype, 'postMessage');
      const done = firstValueFrom(service.logout(), { defaultValue: undefined });
      harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 204, statusText: 'No Content' });
      await done;

      expect(posted).toHaveBeenCalledWith({ type: 'walletSessionEnded', expired: false });
      posted.mockRestore();
      otherTab.close();
    });
  });

  describe('other tabs', () => {
    beforeEach(async () => answerStartupRefresh(harness, session()));

    it('ends this tab session when another tab ends it', () => {
      new BroadcastChannelMock('auth').postMessage({ type: 'walletSessionEnded', expired: false });

      expect(service.isLoggedIn()).toBe(false);
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith('/auth/access');
      expect(service.consumeSessionExpiredNotice()).toBe(false);
    });

    it('shows the expired notice when the session expired in another tab', () => {
      new BroadcastChannelMock('auth').postMessage({ type: 'walletSessionEnded', expired: true });

      expect(service.consumeSessionExpiredNotice()).toBe(true);
    });

    it('tells the other tabs that the session expired', () => {
      const otherTab = new BroadcastChannelMock('auth');
      const received: unknown[] = [];
      otherTab.onmessage = event => received.push(event.data);

      service.forceLogout({ sessionExpired: true });

      expect(received).toEqual([{ type: 'walletSessionEnded', expired: true }]);
      otherTab.close();
    });

    it('discards a renewal that settles after another tab ended the session (M1)', async () => {
      service['accessToken'] = null;
      const renewal = firstValueFrom(service.refreshAccessToken()).catch(err => err);
      await settle();

      new BroadcastChannelMock('auth').postMessage({ type: 'walletSessionEnded', expired: false });
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'late' }));

      expect((await renewal).constructor.name).toBe('SessionChangedError');
      expect(service.isLoggedIn()).toBe(false);
      expect(service.getToken()).toBe('');
    });

    it('resumes the new session when another tab opens one (FR-21)', async () => {
      new BroadcastChannelMock('auth').postMessage('walletSessionOpened');
      expect(service.getToken()).toBe('');

      await settle();
      harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: accessToken('bea@example.com') }));
      await settle();

      expect(service.getToken()).toBe(accessToken('bea@example.com'));
      expect(harness.sessionData.sessionStarted).toHaveBeenCalledTimes(2);
    });
  });

  describe('forceLogout', () => {
    beforeEach(async () => answerStartupRefresh(harness, session()));

    it('ends the session and goes to the access screen without the expired notice by default', () => {
      service.forceLogout();

      expect(service.isLoggedIn()).toBe(false);
      expect(harness.router.navigateByUrl).toHaveBeenCalledWith('/auth/access');
      expect(service.consumeSessionExpiredNotice()).toBe(false);
    });

    it('ignores keepRefreshToken: the cookie is not the app\'s to keep', () => {
      service.forceLogout({ keepRefreshToken: true });

      expect(service.isLoggedIn()).toBe(false);
    });
  });
});

describe('isRefreshTokenRejected', () => {
  it.each([400, 401, 403])('treats %s as a session that is over', status => {
    expect(isRefreshTokenRejected(new HttpErrorResponse({ status }))).toBe(true);
  });

  it.each([0, 429, 500, 503])('treats %s as transient', status => {
    expect(isRefreshTokenRejected(new HttpErrorResponse({ status }))).toBe(false);
  });
});

describe('AUTH_SERVICE_PROVIDER', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('selects LocalAuthService in browser mode, which keeps its local-only contract', async () => {
    TestBed.configureTestingModule({
      providers: [
        AUTH_SERVICE_PROVIDER,
        { provide: WalletDiscoveryService, useValue: { mode: () => 'browser' } },
        { provide: LocalAuthService, useValue: { kind: 'local' } },
        { provide: RemoteAuthService, useValue: { kind: 'remote' } },
      ],
    });

    expect(TestBed.inject(AuthService)).toEqual({ kind: 'local' });
  });

  it('selects RemoteAuthService in server mode', () => {
    TestBed.configureTestingModule({
      providers: [
        AUTH_SERVICE_PROVIDER,
        { provide: WalletDiscoveryService, useValue: { mode: () => 'server' } },
        { provide: LocalAuthService, useValue: { kind: 'local' } },
        { provide: RemoteAuthService, useValue: { kind: 'remote' } },
      ],
    });

    expect(TestBed.inject(AuthService)).toEqual({ kind: 'remote' });
  });
});

describe('RemoteAuthService — pending logout at start-up', () => {
  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('finishes an unconfirmed logout instead of resuming that session', async () => {
    localStorage.setItem('wallet_server_logout_pending', '1');
    const harness = createAuthHarness();

    await settle();
    harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session({ accessToken: 'for-logout' }));
    await settle();
    harness.http.expectOne(`${AUTH_BASE}/sessions/current`).flush(null, { status: 204, statusText: 'No Content' });

    expect(await harness.service.resumeSession()).toBe(false);
    expect(harness.service.isLoggedIn()).toBe(false);
    expect(harness.service.serverLogoutPending()).toBe(false);
    harness.service.dispose();
  });
});

describe('RemoteAuthService — page lifecycle', () => {
  let harness: AuthHarness;

  beforeEach(() => { harness = createAuthHarness(); });

  afterEach(() => {
    harness.service.dispose();
    harness.http.verify();
    TestBed.resetTestingModule();
  });

  function hidePage(): void {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
  }

  it('renews right away when the page is hidden with activity since the last renewal (AC-14)', async () => {
    await answerStartupRefresh(harness, session());
    harness.activity$.next();
    harness.service['lastActivityAt'] = Date.now() + 1;

    hidePage();
    await settle();

    harness.http.expectOne(`${AUTH_BASE}/refresh`).flush(session());
    await settle();
  });

  it('does not renew when the page is hidden without activity', async () => {
    await answerStartupRefresh(harness, session());

    hidePage();
    await settle();

    harness.http.expectNone(`${AUTH_BASE}/refresh`);
  });

  it('drops the attestation copies on pagehide when there is no live session', async () => {
    await answerStartupRefresh(harness, 'rejected');
    harness.sessionData.sessionEnded.mockClear();

    window.dispatchEvent(new Event('pagehide'));

    expect(harness.sessionData.sessionEnded).toHaveBeenCalled();
  });

  it('keeps them on pagehide while the session is alive', async () => {
    await answerStartupRefresh(harness, session());

    window.dispatchEvent(new Event('pagehide'));

    expect(harness.sessionData.sessionEnded).not.toHaveBeenCalled();
  });
});

