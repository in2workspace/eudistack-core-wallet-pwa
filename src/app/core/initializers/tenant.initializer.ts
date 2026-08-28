import { TenantService } from '../services/tenant.service';

/**
 * `APP_INITIALIZER` factory for tenant resolution.
 *
 * Returns an initializer function that calls `TenantService.resolve()` before
 * Angular activates the first route. Must be registered AFTER
 * walletDiscoveryInitializer and BEFORE initializeTheme (AD-1 ordering rule).
 *
 * The outer `catch` is a belt-and-suspenders guard: `resolve()` is designed
 * never to reject, but if an unexpected runtime error escapes, the initializer
 * must still resolve so that Angular bootstrap is never aborted.
 *
 * Registration in `main.ts`:
 * ```ts
 * {
 *   provide: APP_INITIALIZER,
 *   useFactory: tenantInitializer,
 *   deps: [TenantService],
 *   multi: true,
 * }
 * ```
 */
export function tenantInitializer(service: TenantService): () => Promise<void> {
  return () =>
    service
      .resolve()
      .then(() => undefined)
      .catch((err: unknown) => {
        console.error('[Tenant] initializer crashed unexpectedly', err);
        return undefined;
      });
}
