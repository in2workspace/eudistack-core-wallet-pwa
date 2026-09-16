import { TestBed } from '@angular/core/testing';
import { PasskeyStoreService } from './passkey-store.service';

describe('PasskeyStoreService', () => {
  let service: PasskeyStoreService;
  let deletedKeys: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [PasskeyStoreService] });
    service = TestBed.inject(PasskeyStoreService);

    deletedKeys = [];
    // Stub the IndexedDB layer so tests exercise the cache + key-scoping logic
    // without a real database.
    jest.spyOn(service as unknown as { put: () => Promise<void> }, 'put').mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { putAll: () => Promise<void> }, 'putAll').mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { awaitTx: () => Promise<void> }, 'awaitTx').mockResolvedValue(undefined);
    jest.spyOn(service as unknown as { openDatabase: () => Promise<unknown> }, 'openDatabase').mockResolvedValue({
      transaction: () => ({
        objectStore: () => ({ delete: (key: string) => deletedKeys.push(key) }),
      }),
      close: () => undefined,
    });
  });

  describe('per-account WebAuthn user handle', () => {
    it('returns null when nothing is stored for the account', () => {
      expect(service.getWebAuthnUserId('alice@example.com')).toBeNull();
    });

    it('persists the handle under a per-account key and reads it back from cache', async () => {
      await service.setWebAuthnUserId('alice@example.com', 'handle-A');

      expect(service.getWebAuthnUserId('alice@example.com')).toBe('handle-A');
      expect((service as unknown as { put: jest.Mock }).put).toHaveBeenCalledWith({
        key: 'webauthn_user_id:alice@example.com',
        value: 'handle-A',
      });
    });

    it('does not leak one account handle to another account on the same profile', async () => {
      await service.setWebAuthnUserId('alice@example.com', 'handle-A');

      expect(service.getWebAuthnUserId('bob@example.com')).toBeNull();

      await service.setWebAuthnUserId('bob@example.com', 'handle-B');
      expect(service.getWebAuthnUserId('alice@example.com')).toBe('handle-A');
      expect(service.getWebAuthnUserId('bob@example.com')).toBe('handle-B');
    });
  });

  describe('clear() key scoping', () => {
    it('drops the credential but keeps the account handle', async () => {
      await service.setWebAuthnUserId('alice@example.com', 'handle-A');
      await service.setCredentialId('cred-1');

      await service.clear();

      expect(service.getCredentialId()).toBeNull();
      expect(service.hasPasskey()).toBe(false);
      expect(service.getWebAuthnUserId('alice@example.com')).toBe('handle-A');
      expect(deletedKeys).toEqual(['credential_id', 'has_passkey']);
      expect(deletedKeys.some(k => k.startsWith('webauthn_user_id'))).toBe(false);
    });

    it('clearCredentialId() delegates to clear() and keeps the account handle', async () => {
      await service.setWebAuthnUserId('alice@example.com', 'handle-A');
      await service.setCredentialId('cred-1');

      await service.clearCredentialId();

      expect(service.getCredentialId()).toBeNull();
      expect(service.getWebAuthnUserId('alice@example.com')).toBe('handle-A');
    });
  });
});
