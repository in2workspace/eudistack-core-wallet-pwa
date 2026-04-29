import { inject, Provider } from '@angular/core';
import { KeyStorageProvider } from '../spi/key-storage.provider.service';
import { PasskeyPrfKeyStorageProvider } from './passkey-prf-key-storage.service';

export const KEY_STORAGE_PROVIDERS: Provider[] = [
  PasskeyPrfKeyStorageProvider,
  {
    provide: KeyStorageProvider,
    useFactory: () => inject(PasskeyPrfKeyStorageProvider),
  },
];
