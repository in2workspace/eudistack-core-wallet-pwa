import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { VerifiableCredential } from '../models/verifiable-credential';
import { CredentialStatusCheckService } from './credential-status-check.service';
import { CredentialVerificationService } from './credential-verification.service';
import { WalletService } from './wallet.service';

function credential(overrides: Partial<VerifiableCredential> = {}): VerifiableCredential {
  return { id: 'vc-1', lifeCycleStatus: 'VALID', ...overrides } as VerifiableCredential;
}

const withStatusList = {
  statusListCredential: 'https://issuer.example.com/status-list/1',
  statusListIndex: '3',
} as VerifiableCredential['credentialStatus'];

describe('CredentialStatusCheckService', () => {
  let service: CredentialStatusCheckService;
  let cache: CredentialCacheService;
  let isRevoked: jest.Mock;
  let updateCredentialStatus: jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    isRevoked = jest.fn().mockResolvedValue('not-revoked');
    updateCredentialStatus = jest.fn().mockReturnValue(of(undefined));
    TestBed.configureTestingModule({
      providers: [
        { provide: CredentialVerificationService, useValue: { isRevoked } },
        { provide: WalletService, useValue: { updateCredentialStatus } },
      ],
    });
    service = TestBed.inject(CredentialStatusCheckService);
    cache = TestBed.inject(CredentialCacheService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  const statusOf = (id: string) => cache.credentials().find(c => c.id === id)?.lifeCycleStatus;

  describe('expiry', () => {
    it('expires a valid credential whose expiry date has passed and saves it in the service', async () => {
      // Arrange
      cache.setLoaded([credential({ id: 'old', validUntil: '2020-01-01T00:00:00.000Z' })]);

      // Act
      await service.checkAll();

      // Assert
      expect(statusOf('old')).toBe('EXPIRED');
      expect(updateCredentialStatus).toHaveBeenCalledWith('old', 'EXPIRED');
    });

    it('leaves a future, unparseable or absent expiry date untouched', async () => {
      // Arrange
      cache.setLoaded([
        credential({ id: 'new', validUntil: '2099-01-01T00:00:00.000Z' }),
        credential({ id: 'bad', validUntil: 'not-a-date' }),
        credential({ id: 'none' }),
      ]);

      // Act
      await service.checkAll();

      // Assert
      expect(cache.credentials().every(c => c.lifeCycleStatus === 'VALID')).toBe(true);
      expect(updateCredentialStatus).not.toHaveBeenCalled();
    });

    it('does not touch a credential that is already revoked', async () => {
      // Arrange
      cache.setLoaded([credential({ id: 'r', lifeCycleStatus: 'REVOKED', validUntil: '2020-01-01T00:00:00.000Z' })]);

      // Act
      await service.checkAll();

      // Assert
      expect(statusOf('r')).toBe('REVOKED');
      expect(updateCredentialStatus).not.toHaveBeenCalled();
    });
  });

  describe('revocation', () => {
    beforeEach(() => {
      cache.setLoaded([credential({ credentialStatus: withStatusList })]);
    });

    it('revokes the credential and saves it when its status list marks it', async () => {
      // Arrange
      isRevoked.mockResolvedValue('revoked');

      // Act
      await service.checkAll();

      // Assert
      expect(statusOf('vc-1')).toBe('REVOKED');
      expect(updateCredentialStatus).toHaveBeenCalledWith('vc-1', 'REVOKED');
      expect(cache.uncheckedStatusIds().has('vc-1')).toBe(false);
    });

    it('keeps the last known status and flags it as not checked when the status list does not answer', async () => {
      // Arrange
      isRevoked.mockResolvedValue('unknown');

      // Act
      await service.checkAll();

      // Assert — a failed check is never read as "not revoked"
      expect(statusOf('vc-1')).toBe('VALID');
      expect(updateCredentialStatus).not.toHaveBeenCalled();
      expect(cache.uncheckedStatusIds().has('vc-1')).toBe(true);
    });

    it('clears the not-checked flag once the status list answers', async () => {
      // Arrange
      cache.markStatusUnchecked('vc-1');
      isRevoked.mockResolvedValue('not-revoked');

      // Act
      await service.checkAll();

      // Assert
      expect(statusOf('vc-1')).toBe('VALID');
      expect(cache.uncheckedStatusIds().has('vc-1')).toBe(false);
    });

    it('does not check a credential without a status list', async () => {
      // Arrange
      cache.setLoaded([credential({ id: 'plain' })]);

      // Act
      await service.checkAll();

      // Assert
      expect(isRevoked).not.toHaveBeenCalled();
    });

    it('keeps checking the others when one check throws', async () => {
      // Arrange
      cache.setLoaded([
        credential({ id: 'a', credentialStatus: withStatusList }),
        credential({ id: 'b', credentialStatus: withStatusList }),
      ]);
      isRevoked.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('revoked');

      // Act
      await service.checkAll();

      // Assert
      expect(statusOf('a')).toBe('VALID');
      expect(statusOf('b')).toBe('REVOKED');
    });
  });

  describe('saving the status', () => {
    it('shows the new status even when the service cannot save it, and does not reject', async () => {
      // Arrange
      cache.setLoaded([credential({ id: 'old', validUntil: '2020-01-01T00:00:00.000Z' })]);
      updateCredentialStatus.mockReturnValue(throwError(() => new Error('service down')));

      // Act
      await expect(service.checkAll()).resolves.toBeUndefined();

      // Assert
      expect(statusOf('old')).toBe('EXPIRED');
    });
  });

  describe('concurrent checks', () => {
    it('shares the check in progress and allows a new one afterwards', async () => {
      // Arrange
      cache.setLoaded([credential({ credentialStatus: withStatusList })]);

      // Act
      const first = service.checkAll();
      const second = service.checkAll();
      await Promise.all([first, second]);
      await service.checkAll();

      // Assert
      expect(isRevoked).toHaveBeenCalledTimes(2);
    });
  });

  describe('known revocations', () => {
    it('re-applies a remembered revocation after the copy is reloaded', () => {
      // Arrange
      cache.setLoaded([credential({ id: 'vc-1' })]);
      service.rememberRevocation('vc-1');

      // Act
      service.reapplyKnownRevocations();

      // Assert
      expect(statusOf('vc-1')).toBe('REVOKED');
    });
  });
});
