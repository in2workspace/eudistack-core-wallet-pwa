import { TestBed } from '@angular/core/testing';
import { ActivityService } from './activity.service';
import { StorageService } from '../../shared/services/storage.service';

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

describe('ActivityService (EUD-137)', () => {
  let service: ActivityService;
  let storageMock: ReturnType<typeof makeStorageMock>;

  beforeEach(() => {
    storageMock = makeStorageMock();
    TestBed.configureTestingModule({
      providers: [
        ActivityService,
        { provide: StorageService, useValue: storageMock },
      ],
    });
    service = TestBed.inject(ActivityService);
  });

  // --- AC-01 -----------------------------------------------------------

  it('AC-01: logs a "presented" entry and returns it via findAll', async () => {
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
    await service.log('presented', 'Credencial A', 'verifier-a');
    await service.log('deleted', 'Credencial B', 'issuer-b');
    await service.log('presented', 'Credencial C', 'verifier-c');
    const entries = await service.findAll();

    expect(entries.map(e => e.credentialName)).toEqual(['Credencial C', 'Credencial B', 'Credencial A']);
  });

  // --- AC-05 -----------------------------------------------------------

  it('AC-05: persists activity under the single "wallet_activity" storage key', async () => {
    await service.log('presented', 'Empleado ACME', 'verifier.example');

    expect(storageMock.set).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    expect(storageMock.__getRaw(STORAGE_KEY)).toBeDefined();
  });

  // --- AC-07 -----------------------------------------------------------

  it('AC-07: findAll reads from local storage without any network/HttpClient dependency', async () => {
    await service.log('presented', 'Empleado ACME', 'verifier.example');
    const entries = await service.findAll();

    expect(entries.length).toBe(1);
    expect(storageMock.get).toHaveBeenCalled();
  });

  // --- EC-04 -----------------------------------------------------------

  it('EC-04: truncates the log at MAX_ENTRIES = 200, dropping the oldest entries', async () => {
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
    storageMock.get.mockResolvedValueOnce('{not-valid-json');
    const entries = await service.findAll();

    expect(entries).toEqual([]);
  });

  // --- ES-02 -----------------------------------------------------------

  it('ES-02: returns [] without throwing when storage is null', async () => {
    storageMock.get.mockResolvedValueOnce(null);
    const entries = await service.findAll();

    expect(entries).toEqual([]);
  });

  it('clear() removes only the wallet_activity key', async () => {
    await service.log('presented', 'Empleado ACME', 'verifier.example');
    await service.clear();

    expect(storageMock.remove).toHaveBeenCalledWith(STORAGE_KEY);
    const entries = await service.findAll();
    expect(entries).toEqual([]);
  });
});
