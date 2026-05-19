import { Injectable, isDevMode } from '@angular/core';

export type TelemetryEvent =
  | 'ios_onboarding_shown'
  | 'ios_onboarding_dismissed'
  | 'ios_pwa_installed'
  | 'wallet_discovery_resolved'
  | 'wallet_discovery_fallback';

/**
 * Anonymous telemetry for platform-level events (AC-008.10).
 * Stub implementation: logs to console in dev mode.
 * Wire to an analytics endpoint (e.g. DataDog RUM, Matomo) when ready.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  track(event: TelemetryEvent, payload?: Record<string, unknown>): void {
    if (isDevMode()) {
      console.debug('[telemetry]', event, payload ?? {});
    }
    // TODO: forward to analytics endpoint via navigator.sendBeacon or HTTP
  }
}
