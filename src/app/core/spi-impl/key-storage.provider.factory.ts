import { inject, Provider } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { WebCryptoKeyStorageProvider } from './web-crypto-key-storage.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { environment } from 'src/environments/environment';

export const KEY_STORAGE_PROVIDERS: Provider[] = [
  WebCryptoKeyStorageProvider,
  ServerKeyStorageProvider,
  {
    provide: KeyStorageProvider,
    useFactory: () => {
      if ((environment as any).key_storage_mode === 'server') {
        return inject(ServerKeyStorageProvider);
      }
      return inject(WebCryptoKeyStorageProvider);
    },
  },
];
