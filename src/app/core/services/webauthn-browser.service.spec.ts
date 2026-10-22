import { TestBed } from '@angular/core/testing';
import { browserSupportsWebAuthn, getBrowserCapabilities } from '@simplewebauthn/browser';
import { WebAuthnBrowserService } from './webauthn-browser.service';

jest.mock('@simplewebauthn/browser', () => {
  const actual = jest.requireActual('@simplewebauthn/browser');
  return { ...actual, browserSupportsWebAuthn: jest.fn(), getBrowserCapabilities: jest.fn() };
});

describe('WebAuthnBrowserService', () => {
  let service: WebAuthnBrowserService;
  const original = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential;

  beforeEach(() => {
    (browserSupportsWebAuthn as jest.Mock).mockReturnValue(true);
    (getBrowserCapabilities as jest.Mock).mockResolvedValue({
      passkeyPlatformAuthenticator: 'unknown',
      userVerifyingPlatformAuthenticator: 'unknown',
      hybridTransport: 'unknown',
    });
    service = TestBed.inject(WebAuthnBrowserService);
  });

  afterEach(() => {
    (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = original;
    jest.restoreAllMocks();
  });

  describe('isPasskeySupported (FR-01)', () => {
    it('rejects a browser without WebAuthn', async () => {
      (browserSupportsWebAuthn as jest.Mock).mockReturnValue(false);

      await expect(service.isPasskeySupported()).resolves.toBe(false);
    });

    it('accepts a browser that does not report its capabilities', async () => {
      await expect(service.isPasskeySupported()).resolves.toBe(true);
    });

    it('accepts a browser that can only use a passkey of a nearby device', async () => {
      (getBrowserCapabilities as jest.Mock).mockResolvedValue({
        passkeyPlatformAuthenticator: 'unsupported',
        userVerifyingPlatformAuthenticator: 'unsupported',
        hybridTransport: 'supported',
      });

      await expect(service.isPasskeySupported()).resolves.toBe(true);
    });

    it('rejects a browser that reports every way of using a passkey as unsupported', async () => {
      (getBrowserCapabilities as jest.Mock).mockResolvedValue({
        passkeyPlatformAuthenticator: 'unsupported',
        userVerifyingPlatformAuthenticator: 'unsupported',
        hybridTransport: 'unsupported',
      });

      await expect(service.isPasskeySupported()).resolves.toBe(false);
    });
  });

  describe('Signal API (FR-17)', () => {
    it('does nothing, without errors, when the browser has no Signal API', async () => {
      (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {};

      await expect(service.signalUnknownCredential('rp', 'cred')).resolves.toBeUndefined();
      await expect(service.signalAllAcceptedCredentials('rp', 'user', ['cred'])).resolves.toBeUndefined();
      await expect(service.signalCurrentUserDetails('rp', 'user', 'ana@example.com')).resolves.toBeUndefined();
    });

    it('asks the passkey manager to hide an unknown passkey', async () => {
      const signalUnknownCredential = jest.fn().mockResolvedValue(undefined);
      (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { signalUnknownCredential };

      await service.signalUnknownCredential('rp.example', 'cred-1');

      expect(signalUnknownCredential).toHaveBeenCalledWith({ rpId: 'rp.example', credentialId: 'cred-1' });
    });

    it('signals the accepted passkeys and the account name', async () => {
      const signalAllAcceptedCredentials = jest.fn().mockResolvedValue(undefined);
      const signalCurrentUserDetails = jest.fn().mockResolvedValue(undefined);
      (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = { signalAllAcceptedCredentials, signalCurrentUserDetails };

      await service.signalAllAcceptedCredentials('rp.example', 'user-1', ['a', 'b']);
      await service.signalCurrentUserDetails('rp.example', 'user-1', 'ana@example.com');

      expect(signalAllAcceptedCredentials).toHaveBeenCalledWith({ rpId: 'rp.example', userId: 'user-1', allAcceptedCredentialIds: ['a', 'b'] });
      expect(signalCurrentUserDetails).toHaveBeenCalledWith({
        rpId: 'rp.example', userId: 'user-1', name: 'ana@example.com', displayName: 'ana@example.com',
      });
    });

    it('swallows a rejected signal', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential = {
        signalUnknownCredential: jest.fn().mockRejectedValue(new Error('SecurityError')),
      };

      await expect(service.signalUnknownCredential('rp', 'cred')).resolves.toBeUndefined();
    });
  });
});
