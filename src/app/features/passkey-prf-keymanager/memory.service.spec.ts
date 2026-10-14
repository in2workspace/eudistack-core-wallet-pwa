import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { MemoryService } from './memory.service';

const TTL_MS = 300_000;

describe('MemoryService', () => {
  let service: MemoryService;
  let mockDeleteKey: jest.Mock;

  const makeMockKey = (): CryptoKey =>
    ({ type: 'secret', extractable: false, algorithm: { name: 'AES-GCM' }, usages: ['wrapKey'] } as CryptoKey);

  beforeEach(() => {
    mockDeleteKey = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'crypto', {
      value: { subtle: { deleteKey: mockDeleteKey }, getRandomValues: (a: Uint8Array) => a },
      configurable: true,
      writable: true,
    });

    TestBed.configureTestingModule({});
    service = TestBed.inject(MemoryService);
  });

  afterEach(() => jest.useRealTimers());

  // ------------------------------------------------------------------ EC-01

  it('evicts entry and calls deleteKey after TTL', fakeAsync(() => {
    const key = makeMockKey();
    service.set('cred-1', key);

    expect(service.get('cred-1')).toBe(key);

    tick(TTL_MS);

    expect(service.get('cred-1')).toBeUndefined();
    expect(mockDeleteKey).toHaveBeenCalledWith(key);
  }));

  it('resets TTL when same credentialId is overwritten', fakeAsync(() => {
    const key1 = makeMockKey();
    const key2 = makeMockKey();

    service.set('cred-1', key1);
    tick(TTL_MS / 2);

    service.set('cred-1', key2);
    // key1 evicted immediately on overwrite
    expect(mockDeleteKey).toHaveBeenCalledWith(key1);

    tick(TTL_MS - 1);
    expect(service.get('cred-1')).toBe(key2); // key2 still alive

    tick(1);
    expect(service.get('cred-1')).toBeUndefined();
    expect(mockDeleteKey).toHaveBeenCalledWith(key2);
  }));

  it('delete() evicts before TTL and calls deleteKey', fakeAsync(() => {
    const key = makeMockKey();
    service.set('cred-1', key);

    service.delete('cred-1');

    expect(service.get('cred-1')).toBeUndefined();
    expect(mockDeleteKey).toHaveBeenCalledWith(key);
  }));

  // ------------------------------------------------------------------ EC-02

  it('clear() evicts all entries and calls deleteKey for each', fakeAsync(() => {
    const key1 = makeMockKey();
    const key2 = makeMockKey();
    service.set('cred-a', key1);
    service.set('cred-b', key2);

    service.clear();

    expect(service.get('cred-a')).toBeUndefined();
    expect(service.get('cred-b')).toBeUndefined();
    expect(mockDeleteKey).toHaveBeenCalledWith(key1);
    expect(mockDeleteKey).toHaveBeenCalledWith(key2);
  }));

  it('beforeunload listener calls clear()', () => {
    const clearSpy = jest.spyOn(service, 'clear');
    window.dispatchEvent(new Event('beforeunload'));
    expect(clearSpy).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ NFR-S-534-02: no persistence

  it('does not write to localStorage', fakeAsync(() => {
    const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
    service.set('cred-1', makeMockKey());
    tick(TTL_MS);
    expect(setItemSpy).not.toHaveBeenCalled();
  }));

  it('does not write to sessionStorage', fakeAsync(() => {
    const setItemSpy = jest.spyOn(sessionStorage, 'setItem');
    service.set('cred-1', makeMockKey());
    expect(setItemSpy).not.toHaveBeenCalled();
  }));
});