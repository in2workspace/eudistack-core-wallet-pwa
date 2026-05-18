import { WalletDiscoveryService } from '../services/wallet-discovery.service';

/**
 * `APP_INITIALIZER` factory for wallet mode discovery (EUDISTACK-502, Task 5).
 *
 * Returns an initializer function that calls `WalletDiscoveryService.resolve()`
 * before Angular activates the first route (AC-009.1a, AD-1).
 *
 * The outer `catch` is a belt-and-suspenders guard: `resolve()` is itself
 * designed never to reject (AC-009.4), but if an unexpected runtime error
 * escapes the service (e.g. a programming mistake in a future refactor), the
 * initializer must still resolve so that Angular bootstrap is never aborted
 * (AC-009.4 — guarantee of no-abort).
 *
 * Registration in `main.ts`:
 * ```ts
 * {
 *   provide: APP_INITIALIZER,
 *   useFactory: walletDiscoveryInitializer,
 *   deps: [WalletDiscoveryService],
 *   multi: true,
 * }
 * ```
 * This provider MUST be declared **before** `initializeTheme` and
 * `initializePasskeyStore` so that downstream consumers relying on `mode()`
 * are guaranteed to read a resolved snapshot (AD-1 ordering rule).
 */
export function walletDiscoveryInitializer(
  service: WalletDiscoveryService,
): () => Promise<void> {
  return () =>
    service
      .resolve()
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error('[WalletDiscovery] initializer crashed unexpectedly', err);
        return undefined;
      });
}
