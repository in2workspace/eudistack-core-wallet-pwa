import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ServerSessionDataService } from './server-session-data.service';
import { WalletService } from './wallet.service';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { ActivityService } from './activity.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';

describe('ServerSessionDataService', () => {
  let service: ServerSessionDataService;
  let syncCredentials: jest.Mock;
  let storage: { clearAllCredentials: jest.Mock };
  let cache: CredentialCacheService;

  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    syncCredentials = jest.fn().mockReturnValue(of(undefined));
    storage = { clearAllCredentials: jest.fn().mockResolvedValue(undefined) };
    TestBed.configureTestingModule({
      providers: [
        { provide: WalletService, useValue: { syncCredentials } },
        { provide: LocalCredentialStorageService, useValue: storage },
        { provide: ActivityService, useValue: { syncFromServer: jest.fn().mockResolvedValue(undefined) } },
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
});
