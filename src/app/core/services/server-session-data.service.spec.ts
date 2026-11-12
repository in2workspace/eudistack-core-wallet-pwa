import { TestBed } from '@angular/core/testing';
import { map, of, tap, throwError, timer } from 'rxjs';
import { ServerSessionDataService } from './server-session-data.service';
import { SyncSupersededError, WalletService } from './wallet.service';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { ActivityService } from './activity.service';
import { CredentialStatusCheckService } from './credential-status-check.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';

describe('ServerSessionDataService', () => {
  let service: ServerSessionDataService;
  let syncCredentials: jest.Mock;
  let storage: { clearAllCredentials: jest.Mock };
  let cache: CredentialCacheService;
  let checkAll: jest.Mock;
  let invalidatePendingSyncs: jest.Mock;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    // WalletService records the successful synchronization; the real one is replaced here.
    syncCredentials = jest.fn().mockImplementation(() => of(undefined).pipe(tap(() => cache.markSyncSucceeded())));
    checkAll = jest.fn().mockResolvedValue(undefined);
    invalidatePendingSyncs = jest.fn();
    storage = { clearAllCredentials: jest.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: WalletService, useValue: { syncCredentials, invalidatePendingSyncs } },
        { provide: LocalCredentialStorageService, useValue: storage },
        { provide: ActivityService, useValue: { syncFromServer: jest.fn().mockResolvedValue(undefined) } },
        { provide: CredentialStatusCheckService, useValue: { checkAll } },
      ],
    });
    service = TestBed.inject(ServerSessionDataService);
    cache = TestBed.inject(CredentialCacheService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('replaces the local attestations with the session ones when a session starts', async () => {
    await service.sessionStarted();

    expect(syncCredentials).toHaveBeenCalled();
    expect(storage.clearAllCredentials).not.toHaveBeenCalled();
  });

  it('never keeps the attestations of an earlier session when the sync fails', async () => {
    cache.setLoaded([{ id: 'old' } as never]);
    syncCredentials.mockReturnValue(throwError(() => new Error('offline')));

    await service.sessionStarted();

    expect(storage.clearAllCredentials).toHaveBeenCalled();
    expect(cache.status()).toBe('error');
    expect(cache.credentials()).toEqual([]);
  });

  it('drops the local attestations when the session ends', async () => {
    cache.setLoaded([{ id: 'old' } as never]);

    await service.sessionEnded();

    expect(storage.clearAllCredentials).toHaveBeenCalled();
    expect(cache.credentials()).toEqual([]);
  });

  it('forgets the synchronization state when the session ends', async () => {
    await service.sessionStarted();
    cache.markStatusUnchecked('a');

    await service.sessionEnded();

    expect(cache.lastSyncAt()).toBeNull();
    expect(cache.syncError()).toBeNull();
    expect(cache.uncheckedStatusIds().size).toBe(0);
  });

  describe('synchronizations of a session that is over', () => {
    it('sessionEnded makes the synchronizations in flight discard their answer', async () => {
      await service.sessionEnded();

      expect(invalidatePendingSyncs).toHaveBeenCalledTimes(1);
    });

    it('sessionStarted discards the synchronizations of the previous session', async () => {
      await service.sessionStarted();

      expect(invalidatePendingSyncs).toHaveBeenCalledTimes(1);
    });

    it('a refresh that was superseded leaves the state of the new session untouched', async () => {
      cache.setLoaded([{ id: 'kept' } as never]);
      syncCredentials.mockReturnValue(throwError(() => new SyncSupersededError()));

      await service.refresh();

      expect(cache.syncError()).toBeNull();
      expect(cache.credentials()).toHaveLength(1);
      expect(checkAll).not.toHaveBeenCalled();
    });

    it('a session start that was superseded neither drops the copy nor flags an error', async () => {
      syncCredentials.mockReturnValue(throwError(() => new SyncSupersededError()));

      await service.sessionStarted();

      expect(storage.clearAllCredentials).not.toHaveBeenCalled();
      expect(cache.syncError()).toBeNull();
    });
  });

  describe('sessionStarted', () => {
    it('records the time of the synchronization and checks the status afterwards', async () => {
      await service.sessionStarted();

      expect(cache.lastSyncAt()).toBeInstanceOf(Date);
      expect(cache.syncing()).toBe(false);
      expect(cache.syncError()).toBeNull();
      expect(checkAll).toHaveBeenCalledTimes(1);
    });

    it('flags an initial error and does not check the status when the sync fails', async () => {
      syncCredentials.mockReturnValue(throwError(() => new Error('offline')));

      await service.sessionStarted();

      expect(cache.syncError()).toBe('initial');
      expect(cache.syncing()).toBe(false);
      expect(cache.lastSyncAt()).toBeNull();
      expect(checkAll).not.toHaveBeenCalled();
    });

    it('forgets the time of a previous session', async () => {
      cache.markSyncSucceeded(new Date('2020-01-01T00:00:00Z'));
      syncCredentials.mockReturnValue(throwError(() => new Error('offline')));

      await service.sessionStarted();

      expect(cache.lastSyncAt()).toBeNull();
    });
  });

  describe('refresh', () => {
    it('synchronizes without blocking the list, then checks the status', async () => {
      cache.setLoaded([{ id: 'kept' } as never]);
      syncCredentials.mockImplementation(() =>
        timer(0).pipe(map(() => undefined), tap(() => cache.markSyncSucceeded())));

      const pending = service.refresh();

      expect(cache.syncing()).toBe(true);
      expect(cache.status()).toBe('loaded');
      await pending;
      expect(cache.syncing()).toBe(false);
      expect(cache.lastSyncAt()).toBeInstanceOf(Date);
      expect(checkAll).toHaveBeenCalledTimes(1);
    });

    it('keeps the copy of the session and flags a refresh error when the sync fails', async () => {
      cache.setLoaded([{ id: 'kept' } as never]);
      syncCredentials.mockReturnValue(throwError(() => new Error('offline')));

      await service.refresh();

      expect(cache.syncError()).toBe('refresh');
      expect(cache.syncing()).toBe(false);
      expect(cache.credentials()).toHaveLength(1);
      expect(storage.clearAllCredentials).not.toHaveBeenCalled();
      expect(checkAll).not.toHaveBeenCalled();
    });

    it('clears the notice when a later synchronization works', async () => {
      cache.markSyncFailed('refresh');

      await service.refresh();

      expect(cache.syncError()).toBeNull();
    });

    it('starts over as a new session when the session never got its attestations', async () => {
      cache.markSyncFailed('initial');

      await service.refresh();

      expect(cache.syncError()).toBeNull();
      expect(syncCredentials).toHaveBeenCalledTimes(1);
      expect(cache.lastSyncAt()).toBeInstanceOf(Date);
    });
  });
});
