import { TestBed } from '@angular/core/testing';
import { WebCryptoKeyStorageProvider } from './web-crypto-key-storage.service';
import { AppError } from 'src/app/interfaces/error/AppError';

// Minimal Web Crypto API mock for Jest (no Node dependency)
function createMockDigest(): (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer> {
  return jest.fn(async (_algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> => {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array((data as ArrayBufferView).buffer);
    const out = new Uint8Array(32);
    let acc = 0;
    for (let i = 0; i < bytes.length; i++) {
      acc = (acc * 31 + bytes[i]) >>> 0;
      out[i % 32] = (out[i % 32] + bytes[i] + (acc & 0xff)) & 0xff;
    }
    return out.buffer;
  });
}

const mockDigest = createMockDigest();
const mockSubtle: SubtleCrypto = {
  digest: mockDigest as any,
  generateKey: jest.fn().mockResolvedValue({
    privateKey: {} as CryptoKey,
    publicKey: {} as CryptoKey,
  }),
  exportKey: jest.fn().mockResolvedValue({
    kty: 'EC',
    crv: 'P-256',
    x: 'dGVzdC14',
    y: 'dGVzdC15',
  } as JsonWebKey),
  sign: jest.fn().mockResolvedValue(new Uint8Array(64).buffer),
  verify: jest.fn().mockResolvedValue(true),
} as any;

const mockCrypto: Crypto = {
  getRandomValues: jest.fn((arr: ArrayBufferView) => arr),
  randomUUID: jest.fn(() => 'test-uuid-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'),
  subtle: mockSubtle,
} as any;

// Inject mock so it is visible to the service (Zone/jsdom may use a different global ref)
function installMockCrypto(): void {
  Object.defineProperty(globalThis, 'crypto', {
    value: mockCrypto,
    writable: true,
    configurable: true,
  });
}

describe('WebCryptoKeyStorageProvider', () => {
  let service: WebCryptoKeyStorageProvider;
  let originalCrypto: Crypto | undefined;
  let originalIndexedDB: IDBFactory;
  let originalIsSecureContext: boolean | undefined;
  let originalLocation: Location;

  const validJwk: JsonWebKey = {
    kty: 'EC',
    crv: 'P-256',
    x: 'dGVzdC14',
    y: 'dGVzdC15',
  };

  beforeEach(() => {
    originalCrypto = globalThis.crypto;
    originalIndexedDB = globalThis.indexedDB;
    originalIsSecureContext = (globalThis as any).isSecureContext;
    originalLocation = globalThis.location;

    installMockCrypto();
    (globalThis as any).isSecureContext = true;

    TestBed.configureTestingModule({
      providers: [WebCryptoKeyStorageProvider],
    });
    service = TestBed.inject(WebCryptoKeyStorageProvider);
  });

  afterEach(() => {
    if (originalCrypto !== undefined) {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        writable: true,
        configurable: true,
      });
    } else {
      try {
        delete (globalThis as any).crypto;
      } catch {
        (globalThis as any).crypto = undefined;
      }
    }
    (globalThis as any).indexedDB = originalIndexedDB;
    (globalThis as any).isSecureContext = originalIsSecureContext;
    (globalThis as any).location = originalLocation;
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('checkBrowserCompatibility', () => {
    it('should return cached storageMode when already set', async () => {
      (service as any).storageMode = 'in-memory';
      const result = await service.checkBrowserCompatibility();
      expect(result).toBe('in-memory');
    });

    it('should return unavailable when secure context is missing', async () => {
      (globalThis as any).isSecureContext = false;
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:', hostname: 'example.com' },
        writable: true,
      });

      const newService = new WebCryptoKeyStorageProvider();
      const result = await newService.checkBrowserCompatibility();
      expect(result).toBe('unavailable');
    });

    it('should return unavailable when WebCrypto is missing', async () => {
      const mockCrypto = { subtle: undefined };
      (globalThis as any).crypto = mockCrypto;

      const newService = new WebCryptoKeyStorageProvider();
      const result = await newService.checkBrowserCompatibility();
      expect(result).toBe('unavailable');
    });

    it('should return in-memory when IndexedDB is missing', async () => {
      (globalThis as any).indexedDB = undefined;

      const newService = new WebCryptoKeyStorageProvider();
      const result = await newService.checkBrowserCompatibility();
      expect(result).toBe('in-memory');
    });

    it('should resolve to full or in-memory when all APIs are available', async () => {
      const result = await service.checkBrowserCompatibility();
      expect(['full', 'in-memory']).toContain(result);
    });

    it('should use localhost as secure context', async () => {
      (globalThis as any).isSecureContext = undefined;
      Object.defineProperty(globalThis, 'location', {
        value: { protocol: 'http:', hostname: 'localhost' },
        writable: true,
      });

      const newService = new WebCryptoKeyStorageProvider();
      const result = await newService.checkBrowserCompatibility();
      expect(['full', 'in-memory', 'unavailable']).toContain(result);
    });

    it('should fall back to in-memory when IndexedDB smoke test fails', async () => {
      const newService = new WebCryptoKeyStorageProvider();
      const smokeSpy = jest
        .spyOn(newService as any, 'testIndexedDBUsable')
        .mockResolvedValue(false);

      const result = await newService.checkBrowserCompatibility();

      expect(result).toBe('in-memory');
      expect(newService.storageMode).toBe('in-memory');

      smokeSpy.mockRestore();
    });
  });

  describe('computeJwkThumbprint', () => {
    it('should compute thumbprint for valid JWK', async () => {
      const thumbprint = await service.computeJwkThumbprint(validJwk);
      expect(typeof thumbprint).toBe('string');
      expect(thumbprint.length).toBeGreaterThan(0);
      expect(thumbprint).not.toMatch(/[+/=]/);
    });

    it('should throw AppError when JWK is missing crv', async () => {
      const invalidJwk = { ...validJwk, crv: undefined };
      await expect(service.computeJwkThumbprint(invalidJwk as JsonWebKey)).rejects.toThrow(AppError);
      await expect(service.computeJwkThumbprint(invalidJwk as JsonWebKey)).rejects.toMatchObject({
        translationKey: 'errors.invalid-public-jwk',
      });
    });

    it('should throw AppError when JWK is missing kty', async () => {
      const invalidJwk = { ...validJwk, kty: undefined };
      await expect(service.computeJwkThumbprint(invalidJwk as JsonWebKey)).rejects.toThrow(AppError);
    });

    it('should throw AppError when JWK is missing x', async () => {
      const invalidJwk = { ...validJwk, x: undefined };
      await expect(service.computeJwkThumbprint(invalidJwk as JsonWebKey)).rejects.toThrow(AppError);
    });

    it('should throw AppError when JWK is missing y', async () => {
      const invalidJwk = { ...validJwk, y: undefined };
      await expect(service.computeJwkThumbprint(invalidJwk as JsonWebKey)).rejects.toThrow(AppError);
    });

    it('should return same thumbprint for same JWK', async () => {
      const t1 = await service.computeJwkThumbprint(validJwk);
      const t2 = await service.computeJwkThumbprint(validJwk);
      expect(t1).toBe(t2);
    });
  });

  describe('isCnfBoundToPublicKey', () => {
    it('should return false when cnf is null', async () => {
      const result = await service.isCnfBoundToPublicKey(null, validJwk);
      expect(result).toBe(false);
    });

    it('should return false when cnf is undefined', async () => {
      const result = await service.isCnfBoundToPublicKey(undefined, validJwk);
      expect(result).toBe(false);
    });

    it('should return false when cnf has no jwk', async () => {
      const result = await service.isCnfBoundToPublicKey({ other: 'value' }, validJwk);
      expect(result).toBe(false);
    });

    it('should return true when cnf.jwk matches publicKeyJwk', async () => {
      const result = await service.isCnfBoundToPublicKey({ jwk: validJwk }, validJwk);
      expect(result).toBe(true);
    });

    it('should return false when cnf.jwk does not match publicKeyJwk', async () => {
      const otherJwk: JsonWebKey = { ...validJwk, x: 'b3RoZXIteA' };
      const result = await service.isCnfBoundToPublicKey({ jwk: otherJwk }, validJwk);
      expect(result).toBe(false);
    });
  });

  describe('generateKeyPair', () => {
    beforeEach(() => {
      (service as any).storageMode = 'in-memory';
      (service as any).compatibilityCheckPromise = Promise.resolve('in-memory');
    });

    it('should generate key pair and return PublicKeyInfo', async () => {
      const keyId = 'test-key-1';
      const result = await service.generateKeyPair('ES256', keyId);

      expect(result).toMatchObject({
        keyId,
        algorithm: 'ES256',
        kid: expect.any(String),
        createdAt: expect.any(String),
      });
      expect(result.publicKeyJwk).toBeDefined();
      expect(result.publicKeyJwk.kty).toBe('EC');
      expect(result.publicKeyJwk.crv).toBe('P-256');
    });

    it('should cache the generated key', async () => {
      const keyId = 'test-key-cache';
      await service.generateKeyPair('ES256', keyId);

      const signature = await service.sign(keyId, new TextEncoder().encode('test-data'));
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should throw AppError for unsupported algorithm', async () => {
      await expect(
        service.generateKeyPair('RS256' as any, 'key-id')
      ).rejects.toThrow(AppError);
      await expect(
        service.generateKeyPair('RS256' as any, 'key-id')
      ).rejects.toMatchObject({ translationKey: 'errors.unsupported-algorithm' });
    });
  });

  describe('sign', () => {
    beforeEach(() => {
      (service as any).storageMode = 'in-memory';
      (service as any).compatibilityCheckPromise = Promise.resolve('in-memory');
    });

    it('should sign data with cached key', async () => {
      const keyId = 'sign-test-key';
      await service.generateKeyPair('ES256', keyId);

      const data = new TextEncoder().encode('message to sign');
      const signature = await service.sign(keyId, data);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBeGreaterThan(0);
    });

    it('should throw when keyId not found in in-memory mode', async () => {
      (service as any).storageMode = 'in-memory';
      (service as any).compatibilityCheckPromise = Promise.resolve('in-memory');

      await expect(
        service.sign('non-existent-key', new Uint8Array([1, 2, 3]))
      ).rejects.toThrow(AppError);
      await expect(
        service.sign('non-existent-key', new Uint8Array([1, 2, 3]))
      ).rejects.toMatchObject({ translationKey: 'errors.private-key-not-available' });
    });

    it('should throw when keyId not found in full mode', async () => {
      await service.checkBrowserCompatibility();
      if (service.storageMode !== 'full') {
        return;
      }

      await expect(
        service.sign('non-existent-key-in-db', new Uint8Array([1, 2, 3]))
      ).rejects.toThrow(AppError);
      await expect(
        service.sign('non-existent-key-in-db', new Uint8Array([1, 2, 3]))
      ).rejects.toMatchObject({ translationKey: 'errors.signing-key-not-found' });
    });

    it('should sign using key loaded from IndexedDB when not cached in full mode', async () => {
      (service as any).storageMode = 'full';
      (service as any).compatibilityCheckPromise = Promise.resolve('full');

      const keyId = 'db-key';
      const record: any = {
        keyId,
        kid: 'db-kid',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
        publicKeyJwk: validJwk,
        privateKey: {} as CryptoKey,
        publicKey: {} as CryptoKey,
      };

      const getRecordSpy = jest
        .spyOn(service as any, 'getKeyRecordFromIndexedDB')
        .mockResolvedValue(record);

      const data = new Uint8Array([1, 2, 3]);
      const signature = await service.sign(keyId, data);

      expect(getRecordSpy).toHaveBeenCalledWith(keyId);
      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBeGreaterThan(0);

      getRecordSpy.mockRestore();
    });
  });

  describe('resolveKeyIdByKid', () => {
    beforeEach(() => {
      (service as any).storageMode = 'in-memory';
      (service as any).compatibilityCheckPromise = Promise.resolve('in-memory');
    });

    it('should resolve keyId from kid when key is cached', async () => {
      const keyId = 'resolve-test-key';
      const keyInfo = await service.generateKeyPair('ES256', keyId);

      const resolved = await service.resolveKeyIdByKid(keyInfo.kid);
      expect(resolved).toBe(keyId);
    });

    it('should return null when kid not found in in-memory mode', async () => {
      (service as any).storageMode = 'in-memory';
      (service as any).compatibilityCheckPromise = Promise.resolve('in-memory');

      const resolved = await service.resolveKeyIdByKid('unknown-kid');
      expect(resolved).toBeNull();
    });

    it('should return null when kid not in cache and not in DB', async () => {
      await service.checkBrowserCompatibility();
      const resolved = await service.resolveKeyIdByKid('definitely-unknown-kid-12345');
      expect(resolved).toBeNull();
    });

    it('should resolve keyId by kid via IndexedDB when not cached in full mode', async () => {
      (service as any).storageMode = 'full';
      (service as any).compatibilityCheckPromise = Promise.resolve('full');

      const kid = 'db-kid';
      const fakeRecord: any = {
        keyId: 'db-key',
        kid,
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
        publicKeyJwk: validJwk,
      };

      const fakeIndex = {
        get: jest.fn().mockReturnValue(fakeRecord),
      };
      const fakeStore = {
        indexNames: { contains: jest.fn().mockReturnValue(true) },
        index: jest.fn().mockReturnValue(fakeIndex),
      };
      const fakeTx = {
        objectStore: jest.fn().mockReturnValue(fakeStore),
      };
      const fakeDb = {
        transaction: jest.fn().mockReturnValue(fakeTx),
        close: jest.fn(),
      };

      const openDbSpy = jest
        .spyOn(service as any, 'openDatabase')
        .mockResolvedValue(fakeDb as any);
      const wrapSpy = jest
        .spyOn(service as any, 'wrapRequest')
        .mockImplementation(async (value: any) => value);
      const awaitTxSpy = jest
        .spyOn(service as any, 'awaitTx')
        .mockResolvedValue(undefined);

      const resolved = await service.resolveKeyIdByKid(kid);

      expect(openDbSpy).toHaveBeenCalled();
      expect(fakeStore.indexNames.contains).toHaveBeenCalledWith('kid');
      expect(resolved).toBe('db-key');

      openDbSpy.mockRestore();
      wrapSpy.mockRestore();
      awaitTxSpy.mockRestore();
    });
  });

  describe('requireAvailableMode (via generateKeyPair when unavailable)', () => {
    it('should throw when storage is unavailable', async () => {
      (service as any).storageMode = 'unavailable';
      (service as any).compatibilityCheckPromise = Promise.resolve('unavailable');

      await expect(service.generateKeyPair('ES256', 'key')).rejects.toThrow(AppError);
      await expect(service.generateKeyPair('ES256', 'key')).rejects.toMatchObject({
        translationKey: 'errors.key-storage-unavailable',
      });
    });
  });

  describe('compatibility check error handling', () => {
    it('should wrap non-AppError in AppError on compatibility failure', async () => {
      const newService = new WebCryptoKeyStorageProvider();
      const checkSpy = jest
        .spyOn(newService as any, 'checkCompatibilityInternal')
        .mockRejectedValue(new Error('raw error'));

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(newService.checkBrowserCompatibility()).rejects.toThrow(AppError);
      await expect(newService.checkBrowserCompatibility()).rejects.toMatchObject({
        message: 'Browser compatibility check failed',
        translationKey: 'errors.browser-compatibility-check-failed',
      });

      checkSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should rethrow AppError on compatibility failure', async () => {
      const appError = new AppError('custom error', { translationKey: 'errors.custom' });
      const newService = new WebCryptoKeyStorageProvider();
      jest
        .spyOn(newService as any, 'checkCompatibilityInternal')
        .mockRejectedValue(appError);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(newService.checkBrowserCompatibility()).rejects.toThrow(appError);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('IndexedDB internals', () => {
    it('getKeyRecordFromIndexedDB should return record when present', async () => {
      const keyId = 'db-key';
      const fakeRecord: any = {
        keyId,
        kid: 'db-kid',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
        publicKeyJwk: validJwk,
      };

      const fakeStore = {
        get: jest.fn().mockReturnValue(fakeRecord),
      };
      const fakeTx = {
        objectStore: jest.fn().mockReturnValue(fakeStore),
      };
      const fakeDb = {
        transaction: jest.fn().mockReturnValue(fakeTx),
        close: jest.fn(),
      };

      const openDbSpy = jest
        .spyOn(service as any, 'openDatabase')
        .mockResolvedValue(fakeDb as any);
      const wrapSpy = jest
        .spyOn(service as any, 'wrapRequest')
        .mockImplementation(async (value: any) => value);
      const awaitTxSpy = jest
        .spyOn(service as any, 'awaitTx')
        .mockResolvedValue(undefined);

      const result = await (service as any).getKeyRecordFromIndexedDB(keyId);

      expect(result).toEqual(fakeRecord);
      expect(fakeStore.get).toHaveBeenCalledWith(keyId);

      openDbSpy.mockRestore();
      wrapSpy.mockRestore();
      awaitTxSpy.mockRestore();
    });

    it('saveKeyRecordInternal should wrap quota exceeded errors', async () => {
      const record: any = {
        keyId: 'quota-key',
        kid: 'quota-kid',
        algorithm: 'ES256',
        createdAt: new Date().toISOString(),
        publicKeyJwk: validJwk,
      };

      const quotaError = new Error('quota');

      const fakeStore = {
        put: jest.fn(),
      };
      const fakeTx = {
        objectStore: jest.fn().mockReturnValue(fakeStore),
      };
      const fakeDb = {
        transaction: jest.fn().mockReturnValue(fakeTx),
        close: jest.fn(),
      };

      const openDbSpy = jest
        .spyOn(service as any, 'openDatabase')
        .mockResolvedValue(fakeDb as any);
      const wrapSpy = jest
        .spyOn(service as any, 'wrapRequest')
        .mockImplementation(async () => {
          throw quotaError;
        });
      const awaitTxSpy = jest
        .spyOn(service as any, 'awaitTx')
        .mockResolvedValue(undefined);
      const quotaSpy = jest
        .spyOn(service as any, 'isQuotaExceededError')
        .mockReturnValue(true);

      await expect((service as any).saveKeyRecordInternal(record)).rejects.toMatchObject({
        translationKey: 'errors.browser-storage-full',
      });

      openDbSpy.mockRestore();
      wrapSpy.mockRestore();
      awaitTxSpy.mockRestore();
      quotaSpy.mockRestore();
    });
  });
});
