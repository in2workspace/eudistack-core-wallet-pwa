import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { environment } from 'src/environments/environment';
import { RemoteAuthService } from './auth.service';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { TenantService } from './tenant.service';
import { PasskeyCeremonyService, PasskeySession, SessionResponse } from './passkey-ceremony.service';
import { ServerSessionDataService } from './server-session-data.service';
import { WebAuthnBrowserService } from './webauthn-browser.service';
import { PasskeyApiService } from './passkey-api.service';
import { UserActivityService } from './user-activity.service';

/** Test-only helpers for the RemoteAuthService specs (not part of the app bundle). */

export const AUTH_BASE = `${environment.server_url}/api/v1/auth`;

/** BroadcastChannel stand-in that delivers messages to the other channels of the same name. */
export class BroadcastChannelMock {
  static readonly channels: BroadcastChannelMock[] = [];
  onmessage: ((ev: MessageEvent) => unknown) | null = null;

  constructor(public readonly name: string) {
    BroadcastChannelMock.channels.push(this);
  }

  postMessage(data: unknown): void {
    BroadcastChannelMock.channels
      .filter(channel => channel !== this && channel.name === this.name)
      .forEach(channel => channel.onmessage?.({ data } as MessageEvent));
  }

  close(): void {
    const index = BroadcastChannelMock.channels.indexOf(this);
    if (index >= 0) BroadcastChannelMock.channels.splice(index, 1);
  }
}

export function accessToken(email = 'ana@example.com'): string {
  const payload = btoa(JSON.stringify({ sub: 'u1', email })).replace(/=+$/, '');
  return `eyJhbGciOiJFUzI1NiJ9.${payload}.c2ln`;
}

export function session(overrides: Partial<SessionResponse> = {}): SessionResponse {
  return { accessToken: accessToken(), tokenType: 'Bearer', expiresIn: 300, passkeyId: 'pk-1', ...overrides };
}

export function passkeySession(overrides: Partial<PasskeySession> = {}): PasskeySession {
  return { session: session(), rpId: 'sandbox.stg.eudistack.net', userId: 'dXNlcg', credentialId: 'cred-1', ...overrides };
}

/** Lets pending promise chains (lock, firstValueFrom, async helpers) settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

export interface AuthHarness {
  service: RemoteAuthService;
  http: HttpTestingController;
  router: { navigateByUrl: jest.Mock };
  ceremony: { signIn: jest.Mock; register: jest.Mock; hasPasskeyCustody: jest.Mock };
  sessionData: { sessionStarted: jest.Mock; sessionEnded: jest.Mock };
  webAuthn: { signalAllAcceptedCredentials: jest.Mock; signalCurrentUserDetails: jest.Mock; signalUnknownCredential: jest.Mock };
  passkeyApi: { listPasskeys: jest.Mock };
  activity$: Subject<void>;
}

/** Builds RemoteAuthService with its collaborators mocked. The start-up resume is left pending. */
export function createAuthHarness(): AuthHarness {
  (globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = BroadcastChannelMock;
  const harness = {
    router: { navigateByUrl: jest.fn().mockResolvedValue(true) },
    ceremony: { signIn: jest.fn(), register: jest.fn(), hasPasskeyCustody: jest.fn().mockReturnValue(false) },
    sessionData: { sessionStarted: jest.fn().mockResolvedValue(undefined), sessionEnded: jest.fn().mockResolvedValue(undefined) },
    webAuthn: {
      signalAllAcceptedCredentials: jest.fn().mockResolvedValue(undefined),
      signalCurrentUserDetails: jest.fn().mockResolvedValue(undefined),
      signalUnknownCredential: jest.fn().mockResolvedValue(undefined),
    },
    passkeyApi: { listPasskeys: jest.fn().mockReturnValue(of([{ id: 'pk-1', credentialId: 'cred-1' }])) },
    activity$: new Subject<void>(),
  };

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      RemoteAuthService,
      { provide: Router, useValue: harness.router },
      { provide: IssuerMetadataCacheService, useValue: { fetchAndCacheIfMissing: jest.fn().mockResolvedValue(undefined) } },
      { provide: TenantService, useValue: { resolveIssuerBaseUrl: jest.fn().mockResolvedValue('https://issuer.example') } },
      { provide: PasskeyCeremonyService, useValue: harness.ceremony },
      { provide: ServerSessionDataService, useValue: harness.sessionData },
      { provide: WebAuthnBrowserService, useValue: harness.webAuthn },
      { provide: PasskeyApiService, useValue: harness.passkeyApi },
      { provide: UserActivityService, useValue: { activity$: harness.activity$.asObservable() } },
    ],
  });

  return {
    ...harness,
    service: TestBed.inject(RemoteAuthService),
    http: TestBed.inject(HttpTestingController),
  };
}

/** Answers the start-up `POST /auth/refresh`: with a session, or with 401 `invalid_session`. */
export async function answerStartupRefresh(harness: AuthHarness, response: SessionResponse | 'rejected'): Promise<void> {
  await settle();
  const request = harness.http.expectOne(`${AUTH_BASE}/refresh`);
  if (response === 'rejected') {
    request.flush({ type: 'invalid_session', title: 'Invalid session', status: 401 }, { status: 401, statusText: 'Unauthorized' });
  } else {
    request.flush(response);
  }
  await settle();
}
