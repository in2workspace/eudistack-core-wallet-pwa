import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { environment } from 'src/environments/environment';
import { PasskeyCeremonyService } from './passkey-ceremony.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { WebAuthnBrowserService } from './webauthn-browser.service';
import { PasskeyError } from '../models/error/PasskeyError';
import { WalletAuthError } from '../models/error/WalletAuthError';

jest.mock('@simplewebauthn/browser', () => ({
  startAuthentication: jest.fn(),
  startRegistration: jest.fn(),
}));

const AUTH = `${environment.server_url}/api/v1/auth`;
const RP_ID = 'sandbox.stg.eudistack.net';

const requestOptions = {
  ceremonyId: 'c-auth',
  publicKey: { challenge: 'Y2hhbGxlbmdl', rpId: RP_ID, timeout: 60000, allowCredentials: [], userVerification: 'required' },
};
const creationOptions = {
  ceremonyId: 'c-reg',
  publicKey: {
    rp: { id: RP_ID, name: 'EUDIStack Wallet' },
    user: { id: 'dXNlcg', name: 'ana@example.com', displayName: 'ana@example.com' },
    challenge: 'Y2hhbGxlbmdl',
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
    timeout: 120000,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none',
    extensions: { prf: {} },
  },
};
const session = { accessToken: 'at', tokenType: 'Bearer', expiresIn: 300, passkeyId: 'pk-1' };

function authenticationResponse() {
  return {
    id: 'cred-1', rawId: 'cred-1', type: 'public-key',
    response: { clientDataJSON: 'cd', authenticatorData: 'ad', signature: 'sig', userHandle: 'dXNlcg' },
    clientExtensionResults: {},
  };
}

function registrationResponse(prf?: Record<string, unknown>) {
  return {
    id: 'Y3JlZC1uZXc', rawId: 'Y3JlZC1uZXc', type: 'public-key',
    response: { clientDataJSON: 'cd', attestationObject: 'ao' },
    clientExtensionResults: prf ? { prf } : {},
  };
}

function prfAssertion(first?: ArrayBuffer) {
  return { getClientExtensionResults: () => ({ prf: { results: first ? { first } : {} } }) };
}

describe('PasskeyCeremonyService (EUD-8)', () => {
  let service: PasskeyCeremonyService;
  let http: HttpTestingController;
  let keyManager: ReturnType<typeof signal<string | null>>;
  let webAuthn: { signalUnknownCredential: jest.Mock };
  let credentialsGet: jest.Mock;

  const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

  beforeEach(() => {
    keyManager = signal<string | null>('db');
    webAuthn = { signalUnknownCredential: jest.fn().mockResolvedValue(undefined) };
    credentialsGet = jest.fn();
    Object.defineProperty(navigator, 'credentials', { value: { get: credentialsGet }, configurable: true });
    (startAuthentication as jest.Mock).mockReset().mockResolvedValue(authenticationResponse());
    (startRegistration as jest.Mock).mockReset().mockResolvedValue(registrationResponse({ enabled: true }));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: WalletDiscoveryService, useValue: { snapshot: () => () => ({ keyManager: keyManager() }) } },
        { provide: WebAuthnBrowserService, useValue: webAuthn },
      ],
    });
    service = TestBed.inject(PasskeyCeremonyService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  describe('signIn', () => {
    async function signIn(answer: (req: ReturnType<HttpTestingController['expectOne']>) => void) {
      const result = service.signIn();
      http.expectOne(`${AUTH}/sessions/options`).flush(requestOptions);
      await flush();
      answer(http.expectOne(`${AUTH}/sessions`));
      return result;
    }

    it('runs the ceremony with the service options and sends back the ceremony and credential', async () => {
      let body: unknown;
      const result = await signIn(req => { body = req.request.body; req.flush(session); });

      expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: requestOptions.publicKey });
      expect(body).toEqual({ ceremonyId: 'c-auth', credential: authenticationResponse() });
      expect(result).toEqual({ session, rpId: RP_ID, userId: 'dXNlcg', credentialId: 'cred-1' });
    });

    it('does not ask the browser for autofill: the access screen has no username field', async () => {
      await signIn(req => req.flush(session));

      expect((startAuthentication as jest.Mock).mock.calls[0][0].useBrowserAutofill).toBeUndefined();
    });

    it('hides an unknown passkey from the passkey manager and reports it (FR-17)', async () => {
      const result = signIn(req => req.flush({ type: 'unknown_credential', status: 401 }, { status: 401, statusText: 'Unauthorized' }));

      await expect(result).rejects.toMatchObject({ failure: 'unknown_credential' });
      expect(webAuthn.signalUnknownCredential).toHaveBeenCalledWith(RP_ID, 'cred-1');
    });

    it('reports a failed verification without the reason (FR-14)', async () => {
      const result = signIn(req => req.flush({ type: 'authentication_failed', status: 401 }, { status: 401, statusText: 'Unauthorized' }));

      await expect(result).rejects.toMatchObject({ failure: 'authentication_failed' });
      expect(webAuthn.signalUnknownCredential).not.toHaveBeenCalled();
    });

    it('classifies a cancelled picker as a user abort and sends nothing', async () => {
      (startAuthentication as jest.Mock).mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));

      const result = service.signIn();
      http.expectOne(`${AUTH}/sessions/options`).flush(requestOptions);

      await expect(result).rejects.toBeInstanceOf(PasskeyError);
      await expect(result).rejects.toMatchObject({ code: 'passkey_cancelled' });
    });

    it('reports an expired registration ticket', async () => {
      const result = service.signIn();
      http.expectOne(`${AUTH}/sessions/options`).flush({ type: 'invalid_ticket', status: 401 }, { status: 401, statusText: 'Unauthorized' });

      await expect(result).rejects.toMatchObject({ failure: 'invalid_ticket' });
    });
  });

  describe('register', () => {
    async function register(answer: (req: ReturnType<HttpTestingController['expectOne']>) => void, displayName?: string) {
      const result = service.register(displayName);
      http.expectOne(`${AUTH}/passkeys/registration/options`).flush(creationOptions);
      await flush();
      answer(http.expectOne(`${AUTH}/passkeys/registration`));
      return result;
    }

    it('creates the passkey with the service options and registers it', async () => {
      let body: Record<string, unknown> = {};
      const result = await register(req => { body = req.request.body; req.flush(session, { status: 201, statusText: 'Created' }); }, ' Mac ');

      expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: creationOptions.publicKey });
      expect(body).toEqual({
        ceremonyId: 'c-reg',
        credential: registrationResponse({ enabled: true }),
        prfSupported: true,
        displayName: 'Mac',
      });
      expect(result).toEqual({ session, rpId: RP_ID, userId: 'dXNlcg', credentialId: 'Y3JlZC1uZXc' });
    });

    it('omits an empty display name: the service sets one', async () => {
      let body: Record<string, unknown> = {};
      await register(req => { body = req.request.body; req.flush(session); }, '  ');

      expect(body).not.toHaveProperty('displayName');
    });

    it('never sends PRF outputs to the service, only prf.enabled', async () => {
      (startRegistration as jest.Mock).mockResolvedValue(
        registrationResponse({ enabled: true, results: { first: new ArrayBuffer(32) } })
      );
      let body: { credential: { clientExtensionResults: unknown } } | undefined;
      await register(req => { body = req.request.body; req.flush(session); });

      expect(body?.credential.clientExtensionResults).toEqual({ prf: { enabled: true } });
    });

    it('without passkey custody reports prf.enabled as is and runs no extra ceremony', async () => {
      (startRegistration as jest.Mock).mockResolvedValue(registrationResponse());
      let body: Record<string, unknown> = {};
      await register(req => { body = req.request.body; req.flush(session); });

      expect(body['prfSupported']).toBe(false);
      expect(credentialsGet).not.toHaveBeenCalled();
    });

    describe('with passkey custody (FR-08)', () => {
      beforeEach(() => keyManager.set('passkey-prf'));

      it('trusts prf.enabled at creation', async () => {
        await register(req => req.flush(session));

        expect(credentialsGet).not.toHaveBeenCalled();
      });

      it('uses the new passkey once when creation does not confirm the PRF, and registers it with a PRF result (AC-06)', async () => {
        (startRegistration as jest.Mock).mockResolvedValue(registrationResponse({ enabled: false }));
        const output = new Uint8Array(32).fill(7);
        credentialsGet.mockResolvedValue(prfAssertion(output.buffer));
        let body: Record<string, unknown> = {};

        await register(req => { body = req.request.body; req.flush(session); });

        const options = credentialsGet.mock.calls[0][0].publicKey;
        expect(options.rpId).toBe(RP_ID);
        expect(options.allowCredentials).toHaveLength(1);
        expect(options.extensions.prf.eval.first).toBeInstanceOf(Uint8Array);
        expect(body['prfSupported']).toBe(true);
        expect(output.every(byte => byte === 0)).toBe(true);
      });

      it('does not register a passkey without PRF and asks the manager to hide it (AC-05)', async () => {
        (startRegistration as jest.Mock).mockResolvedValue(registrationResponse());
        credentialsGet.mockResolvedValue(prfAssertion());

        const result = service.register();
        http.expectOne(`${AUTH}/passkeys/registration/options`).flush(creationOptions);

        await expect(result).rejects.toBeInstanceOf(WalletAuthError);
        await expect(result).rejects.toMatchObject({ failure: 'passkey_prf_unsupported' });
        expect(webAuthn.signalUnknownCredential).toHaveBeenCalledWith(RP_ID, 'Y3JlZC1uZXc');
        http.expectNone(`${AUTH}/passkeys/registration`);
      });

      it('keeps a cancelled check a cancel (no error screen) but still hides the unregistered passkey', async () => {
        (startRegistration as jest.Mock).mockResolvedValue(registrationResponse());
        credentialsGet.mockRejectedValue(Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }));

        const result = service.register();
        http.expectOne(`${AUTH}/passkeys/registration/options`).flush(creationOptions);

        await expect(result).rejects.toMatchObject({ code: 'passkey_cancelled' });
        expect(webAuthn.signalUnknownCredential).toHaveBeenCalled();
      });

      it('hides the passkey when the service refuses it with passkey_prf_unsupported', async () => {
        const result = register(req => req.flush({ type: 'passkey_prf_unsupported', status: 422 }, { status: 422, statusText: 'Unprocessable' }));

        await expect(result).rejects.toMatchObject({ failure: 'passkey_prf_unsupported' });
        expect(webAuthn.signalUnknownCredential).toHaveBeenCalledWith(RP_ID, 'Y3JlZC1uZXc');
      });
    });

    it('reports a registration the service could not verify without hiding the passkey', async () => {
      const result = register(req => req.flush({ type: 'registration_failed', status: 400 }, { status: 400, statusText: 'Bad Request' }));

      await expect(result).rejects.toMatchObject({ failure: 'registration_failed' });
      expect(webAuthn.signalUnknownCredential).not.toHaveBeenCalled();
    });

    it('reports an expired registration ticket', async () => {
      const result = service.register();
      http.expectOne(`${AUTH}/passkeys/registration/options`).flush({ type: 'invalid_ticket', status: 401 }, { status: 401, statusText: 'Unauthorized' });

      await expect(result).rejects.toMatchObject({ failure: 'invalid_ticket' });
    });
  });
});
