import { inject, Provider } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';

export const KEY_STORAGE_PROVIDERS: Provider[] = [
  PasskeyPrfKeyStorageProvider,
  ServerKeyStorageProvider,
  {
    provide: KeyStorageProvider,
    useFactory: () => {
      const mode = inject(WalletDiscoveryService).mode();
      return mode === 'server'
        ? inject(ServerKeyStorageProvider)
        : inject(PasskeyPrfKeyStorageProvider);
    },
  },
];
