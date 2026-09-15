import { TestBed } from '@angular/core/testing';
import { PasskeyPrfService } from './passkey-prf.service';
import { PasskeyStoreService } from './passkey-store.service';
import { AppError } from '../models/error/AppError';
import { base64UrlEncode } from '../utils/base64url';
import { WEBAUTHN_HINTS } from '../constants/webauthn.constants';

describe('PasskeyPrfService', () => {
  let service: PasskeyPrfService;
  let storeSpy: jest.Mocked<PasskeyStoreService>;

  beforeEach(() => {
    storeSpy = {
      getCredentialId: jest.fn(),
      setCredentialId: jest.fn(),
      clear: jest.fn()
    } as any;

    TestBed.configureTestingModule({
      providers: [
        PasskeyPrfService,
        { provide: PasskeyStoreService, useValue: storeSpy }
      ]
    });

    service = TestBed.inject(PasskeyPrfService);

    // Mock global objects
    const mockCrypto = {
      getRandomValues: (arr: any) => arr,
      subtle: {
        importKey: jest.fn(),
        deriveBits: jest.fn()
      }
    };
    Object.defineProperty(globalThis, 'crypto', {
      value: mockCrypto,
      configurable: true,
      writable: true
    });

    (globalThis as any).PublicKeyCredential = class {};
    (globalThis as any).isSecureContext = true;

    // Use delete and re-define to avoid "read only" error in some environments
    try {
        delete (globalThis as any).location;
    } catch {}

    (globalThis as any).location = {
        protocol: 'https:',
        hostname: 'localhost'
    };

    Object.defineProperty(navigator, 'credentials', {
      value: {
        create: jest.fn(),
        get: jest.fn()
      },
      configurable: true
    });
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('init', () => {
    it('should detect PRF support as available in secure context', async () => {
      const status = await service.init();
      expect(status).toBe('available');
    });

    it('should return unavailable if secure context is missing', async () => {
      (globalThis as any).isSecureContext = false;
      // Force status re-evaluation
      (service as any).status = null;
      const status = await service.init();
      expect(status).toBe('unavailable');
    });
  });

  describe('hasPasskey and getCredentialId', () => {
    it('should return true if store has credential id', () => {
      storeSpy.getCredentialId.mockReturnValue('cred-123');
      expect(service.hasPasskey()).toBe(true);
    });

    it('should return the credential id from store', () => {
      storeSpy.getCredentialId.mockReturnValue('cred-123');
      expect(service.getCredentialId()).toBe('cred-123');
    });
  });

  describe('createPasskey', () => {
    it('should call navigator.credentials.create and store the result', async () => {
      const mockCredential = {
        rawId: new Uint8Array([1, 2, 3]).buffer
      };
      (navigator.credentials.create as jest.Mock).mockResolvedValue(mockCredential);

      const result = await service.createPasskey('Test User');

      expect(navigator.credentials.create).toHaveBeenCalled();
      const expectedId = base64UrlEncode(new Uint8Array(mockCredential.rawId));
      expect(result).toBe(expectedId);
      expect(storeSpy.setCredentialId).toHaveBeenCalledWith(expectedId);

      // EUD bug: Chrome/Edge showed different authenticator pickers because no
      // `hints` was ever sent — assert the standardized hint set is present.
      const call = (navigator.credentials.create as jest.Mock).mock.calls[0][0];
      expect(call.publicKey.hints).toEqual(WEBAUTHN_HINTS);
    });

    it('should throw AppError if creation fails', async () => {
      (navigator.credentials.create as jest.Mock).mockResolvedValue(null);
      await expect(service.createPasskey('Test User')).rejects.toThrow(AppError);
    });
  });

  describe('deriveSigningKey', () => {
    it('should throw AppError if no passkey registered', async () => {
      storeSpy.getCredentialId.mockReturnValue(null);
      await expect(service.deriveSigningKey(new Uint8Array(32))).rejects.toThrow(AppError);
    });

    it('should perform WebAuthn get with PRF extension and derive key', async () => {
      storeSpy.getCredentialId.mockReturnValue(base64UrlEncode(new Uint8Array([1, 2, 3])));

      const mockAssertion = {
        getClientExtensionResults: () => ({
          prf: { results: { first: new Uint8Array(32).buffer } }
        })
      };
      (navigator.credentials.get as jest.Mock).mockResolvedValue(mockAssertion);

      const mockMasterKey = {};
      // Valid P-256 scalar (e.g., 1)
      const validScalar = new Uint8Array(32);
      validScalar[31] = 1;
      const mockDerivedBits = validScalar.buffer;
      const mockPrivateKey = {};

      (globalThis.crypto.subtle.importKey as jest.Mock)
        .mockResolvedValueOnce(mockMasterKey) // import master
        .mockResolvedValueOnce(mockPrivateKey); // import jwk private key

      (globalThis.crypto.subtle.deriveBits as jest.Mock).mockResolvedValue(mockDerivedBits);

      const result = await service.deriveSigningKey(new Uint8Array(32));

      expect(navigator.credentials.get).toHaveBeenCalled();
      expect(result.privateKey).toBe(mockPrivateKey);
      expect(result.publicKeyJwk).toBeDefined();

      const call = (navigator.credentials.get as jest.Mock).mock.calls[0][0];
      expect(call.publicKey.hints).toEqual(WEBAUTHN_HINTS);
    });

    it('should throw AppError if PRF results are missing', async () => {
        storeSpy.getCredentialId.mockReturnValue(base64UrlEncode(new Uint8Array([1, 2, 3])));
        (navigator.credentials.get as jest.Mock).mockResolvedValue({
            getClientExtensionResults: () => ({})
        });

        await expect(service.deriveSigningKey(new Uint8Array(32))).rejects.toThrow(AppError);
    });

    it('should wait for prfLock if another derivation is in progress', async () => {
      storeSpy.getCredentialId.mockReturnValue(base64UrlEncode(new Uint8Array([1, 2, 3])));

      const mockAssertion = {
        getClientExtensionResults: () => ({
          prf: { results: { first: new Uint8Array(32).buffer } }
        })
      };

      let resolveFirst: any;
      const firstGetPromise = new Promise(r => resolveFirst = r);
      (navigator.credentials.get as jest.Mock).mockReturnValueOnce(firstGetPromise);
      (navigator.credentials.get as jest.Mock).mockResolvedValue(mockAssertion);

      const validScalar = new Uint8Array(32);
      validScalar[31] = 1;
      (globalThis.crypto.subtle.importKey as jest.Mock).mockResolvedValue({});
      (globalThis.crypto.subtle.deriveBits as jest.Mock).mockResolvedValue(validScalar.buffer);

      const firstCall = service.deriveSigningKey(new Uint8Array(32));
      const secondCall = service.deriveSigningKey(new Uint8Array(32));

      resolveFirst(mockAssertion);

      await Promise.all([firstCall, secondCall]);

      expect(navigator.credentials.get).toHaveBeenCalledTimes(2);
    });

    it('should throw AppError if navigator.credentials.get returns null', async () => {
        storeSpy.getCredentialId.mockReturnValue(base64UrlEncode(new Uint8Array([1, 2, 3])));
        (navigator.credentials.get as jest.Mock).mockResolvedValue(null);

        await expect(service.deriveSigningKey(new Uint8Array(32))).rejects.toThrow(AppError);
    });

    it('should return unavailable if browser APIs are missing', async () => {
        delete (globalThis as any).PublicKeyCredential;
        (service as any).status = null;
        expect(await service.init()).toBe('unavailable');
    });

    it('detectPrfSupport handles catch branch', async () => {
        (service as any).status = null;
        const original = globalThis.PublicKeyCredential;
        // Mock PublicKeyCredential as an object that throws when any property is accessed if possible
        // but simpler: just mock the getter for something called inside detectPrfSupport
        (globalThis as any).PublicKeyCredential = undefined;
        // In some environments, accessing undefined properties of globalThis might throw if strict
        // But the service does: if (!globalThis.PublicKeyCredential ...)
        // The catch is around the isSecureContext part or other window accesses.

        // Let's mock window.location to throw
        const originalLocation = globalThis.location;
        Object.defineProperty(globalThis, 'location', {
            get: () => { throw new Error('Simulated access error'); },
            configurable: true
        });

        const status = await service.init();
        expect(status).toBe('unavailable');

        Object.defineProperty(globalThis, 'location', {
            value: originalLocation,
            configurable: true
        });
    });
  });

  it('clearPasskey should delegate to store.clear', async () => {
    await service.clearPasskey();
    expect(storeSpy.clear).toHaveBeenCalled();
  });
});
