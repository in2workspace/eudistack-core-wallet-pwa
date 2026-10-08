import { TestBed } from '@angular/core/testing';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';
import { PasskeyPrfService } from '../services/passkey-prf.service';
import { StoredPublicKeyRecord } from '../models/StoredKeyRecord';

const JWK: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'holder-x', y: 'holder-y' };

const record = (keyId: string, kid: string, createdAt: string): StoredPublicKeyRecord => ({
  keyId,
  algorithm: 'ES256',
  publicKeyJwk: JWK,
  kid,
  createdAt,
});

/**
 * Minimal in-memory stand-in for the slice of the IndexedDB API this provider uses.
 * `openDatabase()` is stubbed with it, so the tests never touch a real database —
 * the repo has no fake-indexeddb dependency.
 *
 * Requests resolve on a microtask and transactions complete on a timer, which keeps
 * the ordering the provider relies on: await the request, then await the transaction.
 */
function fakeDatabase(records: StoredPublicKeyRecord[], hasKidIndex = true) {
  const rows = new Map(records.map(r => [r.keyId, r]));
  const close = jest.fn();

  const request = <T>(result: T) => {
    const req = { result, error: null, onsuccess: null, onerror: null } as any;
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };

  const objectStore = {
    indexNames: { contains: (name: string) => hasKidIndex && name === 'kid' },
    get: (key: string) => request(rows.get(key)),
    getAll: () => request([...rows.values()]),
    delete: (key: string) => {
      rows.delete(key);
      return request(undefined);
    },
    put: (row: StoredPublicKeyRecord) => {
      rows.set(row.keyId, row);
      return request(undefined);
    },
    index: () => ({
      get: (kid: string) => request([...rows.values()].find(r => r.kid === kid)),
    }),
  };

  const db = {
    close,
    transaction: () => {
      const tx = { objectStore: () => objectStore, oncomplete: null, onerror: null, onabort: null, error: null } as any;
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };

  return { db, rows, close };
}

describe('PasskeyPrfKeyStorageProvider', () => {
  let provider: PasskeyPrfKeyStorageProvider;
  let deriveSigningKey: jest.Mock;

  beforeEach(() => {
    deriveSigningKey = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        PasskeyPrfKeyStorageProvider,
        { provide: PasskeyPrfService, useValue: { deriveSigningKey } },
      ],
    });

    provider = TestBed.inject(PasskeyPrfKeyStorageProvider);
  });

  const stubDatabase = (records: StoredPublicKeyRecord[], hasKidIndex = true) => {
    const fake = fakeDatabase(records, hasKidIndex);
    jest.spyOn(provider as any, 'openDatabase').mockResolvedValue(fake.db);
    return fake;
  };

  describe('hasKey', () => {
    it('answers from the in-memory cache without opening the database', async () => {
      const openDatabase = jest.spyOn(provider as any, 'openDatabase');
      (provider as any).keyCache.set('cached-key', {} as CryptoKey);

      await expect(provider.hasKey('cached-key')).resolves.toBe(true);
      expect(openDatabase).not.toHaveBeenCalled();
    });

    it('falls back to the stored metadata when the key is not cached', async () => {
      stubDatabase([record('key-1', 'kid-1', '2026-01-01T00:00:00.000Z')]);

      await expect(provider.hasKey('key-1')).resolves.toBe(true);
      await expect(provider.hasKey('key-unknown')).resolves.toBe(false);
    });
  });

  describe('deleteKey', () => {
    it('drops the cached key, removes the stored record and closes the database', async () => {
      const fake = stubDatabase([record('key-1', 'kid-1', '2026-01-01T00:00:00.000Z')]);
      (provider as any).keyCache.set('key-1', {} as CryptoKey);

      await provider.deleteKey('key-1');

      expect((provider as any).keyCache.has('key-1')).toBe(false);
      expect(fake.rows.has('key-1')).toBe(false);
      expect(fake.close).toHaveBeenCalledTimes(1);
    });
  });

  describe('listKeys', () => {
    it('projects every stored record to its public key metadata', async () => {
      stubDatabase([
        record('key-1', 'kid-1', '2026-01-01T00:00:00.000Z'),
        record('key-2', 'kid-2', '2026-02-01T00:00:00.000Z'),
      ]);

      await expect(provider.listKeys()).resolves.toEqual([
        { keyId: 'key-1', algorithm: 'ES256', createdAt: '2026-01-01T00:00:00.000Z' },
        { keyId: 'key-2', algorithm: 'ES256', createdAt: '2026-02-01T00:00:00.000Z' },
      ]);
    });

    it('returns an empty list when nothing is stored', async () => {
      stubDatabase([]);

      await expect(provider.listKeys()).resolves.toEqual([]);
    });
  });

  describe('resolveKeyIdByKid', () => {
    it('resolves the key id through the kid index', async () => {
      stubDatabase([record('key-1', 'kid-1', '2026-01-01T00:00:00.000Z')]);

      await expect(provider.resolveKeyIdByKid('kid-1')).resolves.toBe('key-1');
      await expect(provider.resolveKeyIdByKid('kid-absent')).resolves.toBeNull();
    });

    it('returns null when the store has no kid index', async () => {
      stubDatabase([record('key-1', 'kid-1', '2026-01-01T00:00:00.000Z')], false);

      await expect(provider.resolveKeyIdByKid('kid-1')).resolves.toBeNull();
    });
  });

  describe('unsupported operations in PRF mode', () => {
    it('refuses to export or import a key, because PRF keys are derived and never stored', async () => {
      await expect(provider.exportKey('key-1')).rejects.toMatchObject({
        translationKey: 'errors.operation-not-supported',
      });
      await expect(provider.importKey('key-1', JWK)).rejects.toMatchObject({
        translationKey: 'errors.operation-not-supported',
      });
    });

    it('rejects any algorithm other than ES256', async () => {
      await expect(
        provider.generateKeyPair('RS256' as any, 'key-1')
      ).rejects.toMatchObject({ translationKey: 'errors.unsupported-algorithm' });

      expect(deriveSigningKey).not.toHaveBeenCalled();
    });
  });

  describe('sign', () => {
    it('refuses to re-derive an ephemeral key that is no longer cached', async () => {
      const ephemeralKeyId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

      await expect(provider.sign(ephemeralKeyId, new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
        translationKey: 'errors.signing-key-not-found',
      });
      expect(deriveSigningKey).not.toHaveBeenCalled();
    });
  });

  describe('isCnfBoundToPublicKey', () => {
    it('rejects a cnf that carries no jwk', async () => {
      await expect(provider.isCnfBoundToPublicKey({}, JWK)).resolves.toBe(false);
      await expect(provider.isCnfBoundToPublicKey(undefined, JWK)).resolves.toBe(false);
    });
  });
});
