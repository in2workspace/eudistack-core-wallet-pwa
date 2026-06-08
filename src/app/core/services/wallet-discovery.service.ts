import { inject, Injectable, signal, Signal } from '@angular/core';
import { firstValueFrom, TimeoutError } from 'rxjs';

import { environment } from 'src/environments/environment';
import { isValidWalletConfigMetadataDto } from '../gateways/http-wallet-discovery.gateway';
import { WALLET_DISCOVERY_GATEWAY } from '../gateways/wallet-discovery.gateway';
import {
  WalletDiscoveryFallbackReason,
  WalletDiscoverySnapshot,
  WalletMode,
} from '../models/wallet-discovery.model';
import { TelemetryService } from './telemetry.service';

/**
 * The two valid values for `environment.wallet_mode`.
 * Any other string triggers the `'invalid_env_fallback'` path (E-2, AD-5).
 */
const VALID_WALLET_MODES: ReadonlySet<string> = new Set<WalletMode>(['browser', 'server']);

/**
 * Application-layer service that owns the wallet mode discovery lifecycle
 * for the current PWA session (EUDISTACK-502).
 *
 * Lifecycle:
 *  1. `walletDiscoveryInitializer` (Task 5) calls `resolve()` once inside
 *     `APP_INITIALIZER`, before Angular activates the first route.
 *  2. `resolve()` queries the EBW well-known endpoint via the injected
 *     `WalletDiscoveryGateway`, applies the fallback chain on any failure,
 *     and persists the result in the `_snapshot` signal.
 *  3. All downstream consumers (`AUTH_SERVICE_PROVIDER`, `WalletService`,
 *     `SettingsPage`, `DevicesPage`) call `mode()` synchronously — no
 *     async anywhere after the initializer resolves.
 *
 * Design decisions: AD-1 (APP_INITIALIZER), AD-2 (fallback silencioso),
 * AD-3 (memoización con promise), AD-4 (validador manual), AD-5 (default browser).
 */
@Injectable({ providedIn: 'root' })
export class WalletDiscoveryService {
  private readonly gateway = inject(WALLET_DISCOVERY_GATEWAY);
  private readonly telemetry = inject(TelemetryService);

  /**
   * Persists the resolved snapshot for synchronous access after the initializer.
   * `null` while the initializer has not yet been called (pre-bootstrap only).
   */
  private readonly _snapshot = signal<WalletDiscoverySnapshot | null>(null);

  /**
   * Memoized promise: set on the first call to `resolve()` and reused on
   * any subsequent calls (AC-009.5a, AD-3). One HTTP request per session.
   */
  private _resolvePromise: Promise<WalletDiscoverySnapshot> | null = null;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Read-only projection of the internal signal (AC-009.5b).
   * Exposed for components that want to `effect()`-react to the snapshot
   * rather than polling `mode()`. Most consumers should use `mode()` instead.
   */
  snapshot(): Signal<WalletDiscoverySnapshot | null> {
    return this._snapshot.asReadonly();
  }

  /**
   * Returns the resolved `WalletMode` synchronously (AC-009.5b).
   *
   * MUST be called after the `APP_INITIALIZER` resolves. If called before
   * (should be impossible in normal Angular lifecycle — Angular guarantees
   * initializers complete before the first component mounts), it logs a
   * warning and falls back to `environment.wallet_mode` as a temporary value
   * (AC-009.5c).
   *
   * @returns `'browser'` or `'server'`.
   */
  mode(): WalletMode {
    const snap = this._snapshot();
    if (snap !== null) {
      return snap.mode;
    }

    // AC-009.5c — pre-initializer guard: warn and return env fallback.
    console.warn('[WalletDiscovery] mode() read before initializer resolved');
    return this.resolveEnvMode().mode;
  }

  /**
   * Fetches the EBW well-known endpoint and persists the resulting snapshot.
   *
   * Memoized: the same promise is returned on repeated calls — the HTTP
   * request fires at most once per session (AC-009.5a, AD-3).
   *
   * The returned promise ALWAYS resolves (never rejects). Any failure triggers
   * the fallback chain (AC-009.4). The caller (`walletDiscoveryInitializer`)
   * therefore does not need its own catch — but wraps in one anyway as a
   * belt-and-suspenders guard (§3.2 initializer contract).
   *
   * @returns A promise that resolves to the committed `WalletDiscoverySnapshot`.
   */
  resolve(): Promise<WalletDiscoverySnapshot> {
    this._resolvePromise ??= this.doResolve();
    return this._resolvePromise;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Executes the discovery fetch, validates the response, emits telemetry,
   * and commits the snapshot to the signal.
   *
   * On any error the fallback chain is applied: well-known failed →
   * `environment.wallet_mode` → default `'browser'` (AD-5).
   */
  private async doResolve(): Promise<WalletDiscoverySnapshot> {
    let snapshot: WalletDiscoverySnapshot;

    try {
      const dto = await firstValueFrom(this.gateway.fetch());

      if (!isValidWalletConfigMetadataDto(dto)) {
        snapshot = this.buildFallbackSnapshot({ reason: 'invalid_payload' });
      } else {
        snapshot = {
          mode: dto.wallet_mode as WalletMode,
          source: 'discovery',
          keyManager: dto.key_manager,
          resolvedAt: Date.now(),
        };

        this.telemetry.track('wallet_discovery_resolved', {
          mode: snapshot.mode,
          keyManager: snapshot.keyManager,
        });
      }
    } catch (err) {
      snapshot = this.buildFallbackSnapshot(this.classifyError(err));
    }

    this._snapshot.set(snapshot);
    return snapshot;
  }

  /**
   * Classifies a caught error into a reason + optional HTTP status (W1, AC-009.4b).
   *
   * - `TimeoutError`       → `{ reason: 'timeout' }`                  (AC-009.4c)
   * - `status === 0`       → `{ reason: 'network_error' }`            (AC-009.4a)
   * - `status 4xx / 5xx`  → `{ reason: 'http_error', httpStatus }`   (AC-009.4b)
   * - anything else        → `{ reason: 'network_error' }`            (safe default)
   */
  private classifyError(err: unknown): { reason: WalletDiscoveryFallbackReason; httpStatus?: number } {
    if (err instanceof TimeoutError) {
      return { reason: 'timeout' };
    }

    if (err !== null && typeof err === 'object' && 'status' in err) {
      const status = (err as { status: number }).status;
      if (status === 0) {
        return { reason: 'network_error' };
      }
      if (status >= 400) {
        return { reason: 'http_error', httpStatus: status };
      }
    }

    return { reason: 'network_error' };
  }

  /**
   * Builds a fallback snapshot from `environment.wallet_mode`, applying
   * cascade defaults (E-1, E-2, AD-5).
   *
   * Emits `console.warn` + telemetry for every fallback (AC-009.4a–e).
   * For HTTP errors the telemetry payload includes `httpStatus` (W1, AC-009.4b).
   */
  private buildFallbackSnapshot(
    classification: { reason: WalletDiscoveryFallbackReason; httpStatus?: number }
  ): WalletDiscoverySnapshot {
    const { reason, httpStatus } = classification;
    const envSnap = this.resolveEnvMode();

    console.warn('[WalletDiscovery] fallback to environment.wallet_mode', { reason });

    this.telemetry.track(
      'wallet_discovery_fallback',
      httpStatus !== undefined ? { reason, httpStatus } : { reason }
    );

    return {
      mode: envSnap.mode,
      source: 'fallback',
      keyManager: null,
      resolvedAt: Date.now(),
      fallbackReason: reason,
    };
  }

  /**
   * Resolves the mode from `environment.wallet_mode`, cascading to the safe
   * default `'browser'` if the value is absent or unrecognised (E-1, E-2, AD-5).
   *
   * Returns `{ mode, reason }` so the caller can emit the appropriate reason
   * when both sources fail.
   */
  private resolveEnvMode(): { mode: WalletMode; reason?: WalletDiscoveryFallbackReason } {
    const raw: unknown = environment.wallet_mode;

    if (typeof raw === 'string' && VALID_WALLET_MODES.has(raw)) {
      return { mode: raw as WalletMode };
    }

    if (typeof raw === 'string' && raw !== '') {
      // Recognised string but not a valid mode (E-2).
      console.warn('[WalletDiscovery] invalid environment.wallet_mode value — defaulting to browser', {
        value: raw,
      });
      return { mode: 'browser', reason: 'invalid_env_fallback' };
    }

    // Empty string or non-string (E-1).
    return { mode: 'browser', reason: 'fallback_default' };
  }
}
