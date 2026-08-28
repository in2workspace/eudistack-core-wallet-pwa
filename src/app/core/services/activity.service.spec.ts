import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ActivityService } from './activity.service';
import { StorageService } from '../../shared/services/storage.service';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { ServerActivityGateway } from '../gateways/server-activity.gateway';
import { ActivityEntry } from '../models/activity.model';

const STORAGE_KEY = 'wallet_activity';

function makeStorageMock() {
  let store: Record<string, string | undefined> = {};
  return {
    get: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    set: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    remove: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
    __reset: () => { store = {}; },
    __getRaw: (key: string) => store[key],
  };
}

function makeDiscoveryMock(mode: 'browser' | 'server') {
  return { mode: jest.fn().mockReturnValue(mode) };
}

function makeServerGatewayMock() {
  return {
    list: jest.fn(),
    append: jest.fn(),
  };
}

function setup(
  mode: 'browser' | 'server',
): {
  service: ActivityService;
  storageMock: ReturnType<typeof makeStorageMock>;
  discoveryMock: ReturnType<typeof makeDiscoveryMock>;
  serverGatewayMock: ReturnType<typeof makeServerGatewayMock>;
} {
  const storageMock = makeStorageMock();
  const discoveryMock = makeDiscoveryMock(mode);
  const serverGatewayMock = makeServerGatewayMock();

  TestBed.configureTestingModule({
    providers: [
      ActivityService,
      { provide: StorageService, useValue: storageMock },
      { provide: WalletDiscoveryService, useValue: discoveryMock },
      { provide: ServerActivityGateway, useValue: serverGatewayMock },
    ],
  });

  return {
    service: TestBed.inject(ActivityService),
    storageMock,
    discoveryMock,
    serverGatewayMock,
  };
}

describe('ActivityService (EUD-137)', () => {
  // --- Browser mode: unchanged local-only behaviour --------------------

  describe('browser mode', () => {
    // --- AC-01 -----------------------------------------------------------

    it('AC-01: logs a "presented" entry and returns it via findAll', async () => {
      const { service } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'https://verifier.portal.example/oid4vp');
      const entries = await service.findAll();

      expect(entries.length).toBe(1);
      expect(entries[0]).toMatchObject({
        type: 'presented',
        credentialName: 'Empleado ACME',
        counterparty: 'https://verifier.portal.example/oid4vp',
      });
    });

    // --- AC-03 -----------------------------------------------------------

    it('AC-03: logs a "deleted" entry and returns it via findAll', async () => {
      const { service } = setup('browser');
      await service.log('deleted', 'Certificado viejo', 'ACME Issuer');
      const entries = await service.findAll();

      expect(entries.length).toBe(1);
      expect(entries[0]).toMatchObject({
        type: 'deleted',
        credentialName: 'Certificado viejo',
        counterparty: 'ACME Issuer',
      });
    });

    // --- AC-04 -----------------------------------------------------------

    it('AC-04: findAll returns entries most-recent-first (unshift order)', async () => {
      const { service } = setup('browser');
      await service.log('presented', 'Credencial A', 'verifier-a');
      await service.log('deleted', 'Credencial B', 'issuer-b');
      await service.log('presented', 'Credencial C', 'verifier-c');
      const entries = await service.findAll();

      expect(entries.map(e => e.credentialName)).toEqual(['Credencial C', 'Credencial B', 'Credencial A']);
    });

    // --- AC-05 -----------------------------------------------------------

    it('AC-05: persists activity under the single "wallet_activity" storage key', async () => {
      const { service, storageMock } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'verifier.example');

      expect(storageMock.set).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
      expect(storageMock.__getRaw(STORAGE_KEY)).toBeDefined();
    });

    // --- AC-07 -----------------------------------------------------------

    it('AC-07: findAll reads from local storage without any network/HttpClient dependency', async () => {
      const { service, storageMock } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'verifier.example');
      const entries = await service.findAll();

      expect(entries.length).toBe(1);
      expect(storageMock.get).toHaveBeenCalled();
    });

    // --- EC-04 -----------------------------------------------------------

    it('EC-04: truncates the log at MAX_ENTRIES = 200, dropping the oldest entries', async () => {
      const { service } = setup('browser');
      for (let i = 0; i < 205; i++) {
        await service.log('presented', `Credencial ${i}`, 'verifier.example');
      }
      const entries = await service.findAll();

      expect(entries.length).toBe(200);
      expect(entries[0].credentialName).toBe('Credencial 204');
      expect(entries[199].credentialName).toBe('Credencial 5');
    });

    // --- ES-01 -----------------------------------------------------------

    it('ES-01: returns [] without throwing when stored JSON is corrupt', async () => {
      const { service, storageMock } = setup('browser');
      storageMock.get.mockResolvedValueOnce('{not-valid-json');
      const entries = await service.findAll();

      expect(entries).toEqual([]);
    });

    // --- ES-02 -----------------------------------------------------------

    it('ES-02: returns [] without throwing when storage is null', async () => {
      const { service, storageMock } = setup('browser');
      storageMock.get.mockResolvedValueOnce(null);
      const entries = await service.findAll();

      expect(entries).toEqual([]);
    });

    it('clear() removes only the wallet_activity key', async () => {
      const { service, storageMock } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'verifier.example');
      await service.clear();

      expect(storageMock.remove).toHaveBeenCalledWith(STORAGE_KEY);
      const entries = await service.findAll();
      expect(entries).toEqual([]);
    });

    // --- ES-05 -------------------------------------------------------------

    it('ES-05: log() never calls the server gateway in browser mode', async () => {
      const { service, serverGatewayMock } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'verifier.example');

      expect(serverGatewayMock.append).not.toHaveBeenCalled();
    });

    it('ES-05: findAll() never calls the server gateway in browser mode', async () => {
      const { service, serverGatewayMock } = setup('browser');
      await service.findAll();

      expect(serverGatewayMock.list).not.toHaveBeenCalled();
    });

    it('ES-05: syncFromServer() is a no-op in browser mode (no gateway call, cache untouched)', async () => {
      const { service, serverGatewayMock, storageMock } = setup('browser');
      await service.log('presented', 'Empleado ACME', 'verifier.example');
      storageMock.set.mockClear();

      await service.syncFromServer();

      expect(serverGatewayMock.list).not.toHaveBeenCalled();
      expect(storageMock.set).not.toHaveBeenCalled();
    });
  });

  // --- Server mode: EBW-backed, IndexedDB as cache ----------------------

  describe('server mode', () => {
    const SERVER_ENTRY: ActivityEntry = {
      id: 'srv-1',
      type: 'issued',
      credentialName: 'LEARCredentialEmployee',
      counterparty: 'https://issuer.example.com',
      timestamp: 1_700_000_000_000,
    };

    // --- AC-01 / AC-03 (server = source of truth) -------------------------

    it('AC-01/AC-03: findAll() fetches from the server and overwrites the local cache', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      serverGatewayMock.list.mockReturnValueOnce(of([SERVER_ENTRY]));

      const entries = await service.findAll();

      expect(serverGatewayMock.list).toHaveBeenCalledTimes(1);
      expect(entries).toEqual([SERVER_ENTRY]);
      expect(storageMock.set).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify([SERVER_ENTRY]));
    });

    // --- AC-01 (recovery via syncFromServer) --------------------------------

    it('AC-01: syncFromServer() clears divergence by overwriting the cache with the server response', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      serverGatewayMock.list.mockReturnValueOnce(of([SERVER_ENTRY]));

      await service.syncFromServer();

      expect(serverGatewayMock.list).toHaveBeenCalledTimes(1);
      expect(storageMock.__getRaw(STORAGE_KEY)).toBe(JSON.stringify([SERVER_ENTRY]));
    });

    // --- EC-04 -------------------------------------------------------------

    it('EC-04: findAll() returns [] when the server history is empty', async () => {
      const { service, serverGatewayMock } = setup('server');
      serverGatewayMock.list.mockReturnValueOnce(of([]));

      const entries = await service.findAll();

      expect(entries).toEqual([]);
    });

    // --- AC-04 (persistence of a new event) ---------------------------------

    it('AC-04: log() writes to the local cache and appends to the server', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      serverGatewayMock.append.mockReturnValueOnce(of(undefined));

      await service.log('presented', 'Empleado ACME', 'verifier.example');

      expect(storageMock.set).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
      expect(serverGatewayMock.append).toHaveBeenCalledTimes(1);
      expect(serverGatewayMock.append.mock.calls[0][0]).toMatchObject({
        type: 'presented',
        credentialName: 'Empleado ACME',
        counterparty: 'verifier.example',
      });
    });

    // --- ES-04 (offline fallback) --------------------------------------------

    it('ES-04: findAll() falls back to the local cache when the server is unreachable, without throwing', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      // Pre-existing cached entry, as if a previous successful sync had happened.
      await storageMock.set(STORAGE_KEY, JSON.stringify([SERVER_ENTRY]));
      serverGatewayMock.list.mockReturnValueOnce(throwError(() => new Error('network down')));

      const entries = await service.findAll();

      expect(entries).toEqual([SERVER_ENTRY]);
    });

    it('ES-04: syncFromServer() never clears the cache on a failed fetch (AD-4)', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      await storageMock.set(STORAGE_KEY, JSON.stringify([SERVER_ENTRY]));
      storageMock.set.mockClear();
      serverGatewayMock.list.mockReturnValueOnce(throwError(() => new Error('network down')));

      await expect(service.syncFromServer()).resolves.toBeUndefined();

      expect(storageMock.set).not.toHaveBeenCalled();
      expect(storageMock.__getRaw(STORAGE_KEY)).toBe(JSON.stringify([SERVER_ENTRY]));
    });

    it('log() does not reject when the server append fails (best-effort, AD-1)', async () => {
      const { service, storageMock, serverGatewayMock } = setup('server');
      serverGatewayMock.append.mockReturnValueOnce(throwError(() => new Error('network down')));

      await expect(
        service.log('presented', 'Empleado ACME', 'verifier.example'),
      ).resolves.toBeUndefined();

      expect(storageMock.set).toHaveBeenCalled();
    });
  });
});
