import { inject, Provider } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { HybridKeyStorageProvider } from './hybrid-key-storage.provider';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';

export const KEY_STORAGE_PROVIDERS: Provider[] = [
  PasskeyPrfKeyStorageProvider,
  ServerKeyStorageProvider,
  HybridKeyStorageProvider,
  {
    provide: KeyStorageProvider,
    useFactory: () => {
      const discovery = inject(WalletDiscoveryService);
      const mode = discovery.mode();
      const snap = discovery.snapshot()();
      if (mode === 'server' && snap?.keyManager === 'hybrid') {
        return inject(HybridKeyStorageProvider);
      }
      return mode === 'server'
        ? inject(ServerKeyStorageProvider)
        : inject(PasskeyPrfKeyStorageProvider);
    },
  },
];
