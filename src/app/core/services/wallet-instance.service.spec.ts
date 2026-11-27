import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { isInstanceRequired, WalletInstance, WalletInstanceService } from './wallet-instance.service';
import { UrlResolverService } from './url-resolver.service';

const SERVER = 'https://wallet.example.com/business-wallet';
const BASE = `${SERVER}/api/v1/wallet-instances`;

/** Lets the IndexedDB stand-in and the promise chains settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

/** Minimal IndexedDB stand-in: one object store kept in a Map, async like the real one. */
function installIndexedDb(): Map<string, unknown> {
  const data = new Map<string, unknown>();
  const request = <T>(run: () => T) => {
    const req: { result?: T; onsuccess?: () => void } = {};
    return { req, run };
  };
  const store = {
    get: (key: string) => {
      const { req } = request(() => undefined);
      req.result = data.get(key) as never;
      return req;
    },
    put: (value: unknown, key: string) => {
      data.set(key, value);
      return {};
    },
    delete: (key: string) => {
      data.delete(key);
      return {};
    },
  };
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: jest.fn(),
    close: jest.fn(),
    transaction: () => {
      const tx: { objectStore: () => typeof store; oncomplete?: () => void; onerror?: () => void } = {
        objectStore: () => store,
      };
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const open: { result: typeof db; onsuccess?: () => void; onupgradeneeded?: () => void; onerror?: () => void } = { result: db };
      setTimeout(() => open.onsuccess?.(), 0);
      return open;
    },
  };
  return data;
}

function instance(overrides: Partial<WalletInstance> = {}): WalletInstance {
  return {
    id: 'wi-1', displayName: 'iPhone · Safari', deviceType: 'mobile',
    createdAt: '2026-10-12T10:00:00Z', lastUsedAt: null, current: true, ...overrides,
  };
}

describe('WalletInstanceService (EUD-15 design §2.2)', () => {
  let service: WalletInstanceService;
  let http: HttpTestingController;
  let stored: Map<string, unknown>;

  beforeEach(() => {
    stored = installIndexedDb();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => SERVER } },
      ],
    });
    service = TestBed.inject(WalletInstanceService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('without a remembered device, asks for the registration and calls nothing (FR-01)', async () => {
    expect(await service.bindRemembered('sub-1')).toBe('unregistered');
  });

  it('binds the session to the remembered device of the account, silently (FR-05)', async () => {
    stored.set('sub-1', { instanceId: 'wi-1' });

    const result = service.bindRemembered('sub-1');
    await settle();
    const request = http.expectOne(`${BASE}/current`);
    request.flush(instance());

    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ instanceId: 'wi-1' });
    expect(await result).toBe('bound');
  });

  it.each(['instance_revoked', 'instance_not_found'])('forgets a device answered %s and asks for a new one (FR-07)', async type => {
    stored.set('sub-1', { instanceId: 'wi-1' });

    const result = service.bindRemembered('sub-1');
    await settle();
    http.expectOne(`${BASE}/current`).flush({ type, status: 410 }, { status: 410, statusText: 'Gone' });

    expect(await result).toBe('unregistered');
    await settle();
    expect(stored.has('sub-1')).toBe(false);
  });

  it('keeps the device after a temporary failure', async () => {
    stored.set('sub-1', { instanceId: 'wi-1' });

    const result = service.bindRemembered('sub-1');
    await settle();
    http.expectOne(`${BASE}/current`).flush(null, { status: 503, statusText: 'Unavailable' });

    expect(await result).toBe('unavailable');
    expect(stored.get('sub-1')).toEqual({ instanceId: 'wi-1' });
  });

  it('registers the device with its trimmed name and type, and remembers it by sub, never by email (FR-03)', async () => {
    const result = service.register('sub-1', '  Mac · Chrome ', 'desktop');
    await settle();
    const request = http.expectOne(BASE);
    request.flush(instance({ id: 'wi-2' }), { status: 201, statusText: 'Created' });

    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ displayName: 'Mac · Chrome', deviceType: 'desktop' });
    expect((await result).id).toBe('wi-2');
    expect(stored.get('sub-1')).toEqual({ instanceId: 'wi-2' });
    expect([...stored.keys()].some(key => key.includes('@'))).toBe(false);
  });

  it('asks once for persistent storage after registering', async () => {
    const persist = jest.fn().mockResolvedValue(true);
    Object.defineProperty(navigator, 'storage', {
      configurable: true, value: { persisted: jest.fn().mockResolvedValue(false), persist },
    });

    const result = service.register('sub-1', 'Mac · Chrome', 'desktop');
    await settle();
    http.expectOne(BASE).flush(instance());
    await result;
    await settle();

    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('binds to the device another tab has just registered instead of registering a second one', async () => {
    stored.set('sub-1', { instanceId: 'wi-1' });

    const result = service.register('sub-1', 'Mac · Chrome', 'desktop');
    await settle();
    const bind = http.expectOne(`${BASE}/current`);
    bind.flush(instance());

    expect(bind.request.method).toBe('PUT');
    expect((await result).id).toBe('wi-1');
    http.expectNone(req => req.method === 'POST');
  });

  it('lists, renames and revokes the devices of the account', () => {
    service.list().subscribe();
    expect(http.expectOne(BASE).request.method).toBe('GET');

    service.rename('wi-1', ' Portátil ').subscribe();
    const rename = http.expectOne(`${BASE}/wi-1`);
    expect(rename.request.method).toBe('PATCH');
    expect(rename.request.body).toEqual({ displayName: 'Portátil' });

    service.revoke('wi-1').subscribe();
    expect(http.expectOne(`${BASE}/wi-1`).request.method).toBe('DELETE');
  });

  it('recognises the 403 instance_required', () => {
    expect(isInstanceRequired(new HttpErrorResponse({ status: 403, error: { type: 'instance_required', status: 403 } })))
      .toBe(true);
    expect(isInstanceRequired(new HttpErrorResponse({ status: 403, error: { type: 'forbidden', status: 403 } })))
      .toBe(false);
  });
});
