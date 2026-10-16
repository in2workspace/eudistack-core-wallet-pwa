import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';
import { Storage } from '@ionic/storage-angular';

describe('StorageService', () => {
  let service: StorageService;
  let ionicStorage: jest.Mocked<any>;
  let resolveCreate: () => void;

  beforeEach(() => {
    // Like the real Ionic Storage, `create()` resolves with the very same instance.
    ionicStorage = {
      create: jest.fn(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
      length: jest.fn(),
    };
    ionicStorage.create.mockImplementation(
      () => new Promise(resolve => (resolveCreate = () => resolve(ionicStorage)))
    );

    TestBed.configureTestingModule({
      providers: [StorageService, { provide: Storage, useValue: ionicStorage }],
    });
    service = TestBed.inject(StorageService);
  });

  it('should be created without touching the Ionic storage', () => {
    expect(service).toBeTruthy();
    expect(ionicStorage.create).not.toHaveBeenCalled();
  });

  it('should set a value in storage', async () => {
    const pending = service.set('testKey', 'testValue');
    resolveCreate();
    await pending;

    expect(ionicStorage.set).toHaveBeenCalledTimes(1);
    expect(ionicStorage.set).toHaveBeenCalledWith('testKey', 'testValue');
  });

  it('should get a value from storage', async () => {
    ionicStorage.get.mockResolvedValue('testValue');

    const pending = service.get('testKey');
    resolveCreate();

    expect(await pending).toEqual('testValue');
    expect(ionicStorage.get).toHaveBeenCalledWith('testKey');
  });

  it('should get all values from storage, using an empty string for missing ones', async () => {
    ionicStorage.length.mockResolvedValue(3);
    ionicStorage.get
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('c');

    const pending = service.findAll();
    resolveCreate();

    expect(await pending).toEqual(['a', '', 'c']);
    expect(ionicStorage.get).toHaveBeenNthCalledWith(1, '0');
    expect(ionicStorage.get).toHaveBeenNthCalledWith(3, '2');
  });

  it('should remove a value from storage', async () => {
    const pending = service.remove('testKey');
    resolveCreate();
    await pending;

    expect(ionicStorage.remove).toHaveBeenCalledWith('testKey');
  });

  describe('first use before the storage is created', () => {
    it('does not drop a set() made while create() is still pending', async () => {
      const pending = service.set('early-key', 'early-value');
      await Promise.resolve();

      expect(ionicStorage.set).not.toHaveBeenCalled();

      resolveCreate();
      await pending;

      expect(ionicStorage.set).toHaveBeenCalledWith('early-key', 'early-value');
    });

    it('creates the storage once, however many operations are issued', async () => {
      const operations = [service.set('a', 1), service.get('a'), service.remove('a')];
      resolveCreate();
      await Promise.all(operations);
      await service.set('b', 2);

      expect(ionicStorage.create).toHaveBeenCalledTimes(1);
    });

    it('propagates a creation failure to the caller instead of swallowing the operation', async () => {
      ionicStorage.create.mockImplementation(() => Promise.reject(new Error('indexeddb unavailable')));

      await expect(service.set('k', 'v')).rejects.toThrow('indexeddb unavailable');
      expect(ionicStorage.set).not.toHaveBeenCalled();
    });

    it('retries the creation on the next operation after a failure', async () => {
      ionicStorage.create.mockImplementationOnce(() => Promise.reject(new Error('indexeddb unavailable')));
      await expect(service.set('k', 'v')).rejects.toThrow('indexeddb unavailable');

      ionicStorage.create.mockImplementationOnce(() => Promise.resolve(ionicStorage));
      await service.set('k', 'v');

      expect(ionicStorage.create).toHaveBeenCalledTimes(2);
      expect(ionicStorage.set).toHaveBeenCalledWith('k', 'v');
    });
  });
});
