import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { KEY_STORAGE_PROVIDERS } from './key-storage.provider.factory';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { ServerPasskeyPrfKeyStorageProvider } from './server-passkey-prf-key-storage.provider';

const BROWSER_PROVIDER = { id: 'browser' };
const SERVER_PROVIDER = { id: 'server' };
const SERVER_PASSKEY_PRF_PROVIDER = { id: 'server-passkey-prf' };

/** Resolves the KeyStorageProvider the factory selects for a given discovery state. */
function resolveProvider(mode: 'server' | 'browser', keyManager: string | null): unknown {
  const factoryProvider = KEY_STORAGE_PROVIDERS.find(
    (p: Provider) => (p as { provide?: unknown }).provide === KeyStorageProvider,
  ) as Provider;
  TestBed.configureTestingModule({
    providers: [
      { provide: WalletDiscoveryService, useValue: { mode: () => mode, snapshot: () => () => ({ mode, keyManager }) } },
      { provide: PasskeyPrfKeyStorageProvider, useValue: BROWSER_PROVIDER },
      { provide: ServerKeyStorageProvider, useValue: SERVER_PROVIDER },
      { provide: ServerPasskeyPrfKeyStorageProvider, useValue: SERVER_PASSKEY_PRF_PROVIDER },
      factoryProvider,
    ],
  });
  return TestBed.inject(KeyStorageProvider);
}

describe('KEY_STORAGE_PROVIDERS factory', () => {
  it('resolves ServerPasskeyPrfKeyStorageProvider when mode is server and keyManager is passkey-prf', () => {
    expect(resolveProvider('server', 'passkey-prf')).toBe(SERVER_PASSKEY_PRF_PROVIDER);
  });

  it('resolves ServerKeyStorageProvider when mode is server and keyManager is not passkey-prf', () => {
    expect(resolveProvider('server', null)).toBe(SERVER_PROVIDER);
  });

  it('resolves PasskeyPrfKeyStorageProvider when mode is browser', () => {
    expect(resolveProvider('browser', 'passkey-prf')).toBe(BROWSER_PROVIDER);
  });
});
