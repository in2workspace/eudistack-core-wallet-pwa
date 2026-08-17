import { Injectable, isDevMode } from '@angular/core';

export type TelemetryEvent =
  | 'ios_onboarding_shown'
  | 'ios_onboarding_dismissed'
  | 'ios_pwa_installed'
  | 'wallet_discovery_resolved'
  | 'wallet_discovery_fallback'
  | 'hybrid_onboarding_shown'
  | 'hybrid_onboarding_accepted'
  | 'about_legal_document_load_failed'
  | 'about_oss_licenses_unavailable'
  // --- EUD-142 (runtime UI translation) ---
  // Payload restricted to language codes, status and counts — never text or
  // rejected keys (FR-25 / NFR-Pr-03).
  | 'ui_translation_enabled'
  | 'ui_translation_disabled'
  | 'ui_translation_unavailable'
  | 'ui_translation_engine_failed'
  | 'ui_translation_rejected_entry'
  | 'ui_translation_placeholder_mismatch'
  | 'ui_translation_cache_unavailable';

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
