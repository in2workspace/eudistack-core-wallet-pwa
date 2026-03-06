import { inject, Provider } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { environment } from 'src/environments/environment';

export const KEY_STORAGE_PROVIDERS: Provider[] = [
  PasskeyPrfKeyStorageProvider,
  ServerKeyStorageProvider,
  {
    provide: KeyStorageProvider,
    useFactory: () => {
      if ((environment as any).wallet_mode === 'server') {
        return inject(ServerKeyStorageProvider);
      }
      return inject(PasskeyPrfKeyStorageProvider);
    },
  },
];
