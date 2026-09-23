import { inject, Provider } from '@angular/core';
import { AuthService, RemoteAuthService } from './auth.service';
import { LocalAuthService } from './local-auth.service';
import { WalletDiscoveryService } from './wallet-discovery.service';

/**
 * DI provider that selects the right AuthService implementation based on the
 * wallet mode resolved at bootstrap by `WalletDiscoveryService` (AC-009.2b,
 * AC-009.3b, AC-009.5d — EUDISTACK-502).
 *
 * Lives in its own file so `LocalAuthService` can extend `AuthService` without a
 * circular import (`auth.service.ts` used to import `LocalAuthService` here).
 *
 * The factory runs after `APP_INITIALIZER` completes, so `mode()` is always
 * synchronous and deterministic for the session (AD-3).
 */
export const AUTH_SERVICE_PROVIDER: Provider = {
  provide: AuthService,
  useFactory: () => {
    console.log("AUTH_SERVICE_PROVIDER: mode is: " + inject(WalletDiscoveryService).mode());
    if (inject(WalletDiscoveryService).mode() === 'server') {
      return inject(RemoteAuthService);
    }
    return inject(LocalAuthService);
  },
};
