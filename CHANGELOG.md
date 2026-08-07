# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.14.3] - 2026-08-06

### Added

- **Wallet login redesign (DOME mocks)**: the access, email, verify-email and passkey screens move from a centered card on a gradient to a full-page layout with a decorative watermark per screen, applied as a CSS mask so its colour follows the theme (pale blue in light mode, `--surface-muted` in dark). New i18n keys in `en`/`es`/`ca`, with the product name interpolated from the tenant `branding.name` instead of hardcoded.
- **Verification code resend**: the OTP screen starts a 3-minute cooldown when a code is sent, showing `mm:ss` and then a "Resend it" action. The interval is cleared when the step is left, the code is verified or the view is destroyed.
- **"Need help?" modal on the access screen**: three FAQs about recovering an existing wallet, using a new device and continuing without installing. Below 768px it presents as a bottom sheet without the intro line or the bottom Close button, matching the phone mocks.

### Changed

- **`LoginPage` — single source of truth for the current screen**: screen selection was duplicated across five template conditions plus a sixth, divergent copy in the `watermark` getter, which checked `showInstallScreen` alone — always `true` in a non-standalone browser — so every step rendered the access artwork once the installability probe answered "not installable". All six collapse into one `screen` computed, and the template branches on a single `@switch`, making the states mutually exclusive by construction.
- **`LoginPage` — getters migrated to signals**: `screen`, `watermark`, `canGoBack`, `brandName` and `resendCountdown` become `computed()`, with `showInstallScreen`, `step` and `resendSecondsLeft` as writable signals. `brandName` now derives from `toSignal(getTheme())` instead of the non-reactive `ThemeService.snapshot`, so it updates if the theme settles after the first render.
- **`LoginPage` — template extracted to `login.page.html`**: aligns the page with the repo convention (15 of 17 `*.page.ts` already use `templateUrl`) and drops `login.page.ts` from 688 to 473 lines. The watermark's artwork mapping and mask geometry move from the stylesheet into `watermarkStyle()`, next to the decision that drives them.
- **Blinker now applies inside Ionic components**: `ion-content` declares `font-family: var(--ion-font-family, inherit)` on its own host, and an element's own declaration beats an inherited value — so everything rendered inside an `ion-content` fell back to Ionic's default. `ion-content` added to the `global.scss` selector.

## [3.14.2] - 2026-08-07

### Fixed

- **EUDISTACK-548 — SSO session cookie never reached the browser on `POST /oid4vp/auth-response`**: the Verifier's `SsoSessionAuthenticationSuccessHandler` sets the SSO session cookie as a `Set-Cookie` header on this response, but the call is cross-origin (`wallet.<tenant>.*` → `verifier.<tenant>.*`). A browser only stores a cross-origin `Set-Cookie` when both sides opt into credentials — `WalletService.postOid4vpAuthorizationResponse()` now sends `withCredentials: true` (paired with the matching `Access-Control-Allow-Credentials: true` fix in `eudistack-core-verifier`). Without it, every SSO establishment silently discarded the cookie, so every later `prompt=none` silent-reuse attempt saw zero cookies regardless of the server-side CORS config.

## [3.14.1] - 2026-07-28

### Changed

- **Camera permission denied is no longer shown as a red error modal**: `CameraService.alertCameraErrorsByErrorName()` routed every camera failure — including a routine, user-recoverable permission denial — through `AlertController` (`custom-alert-error`), a centered red modal that read as "something crashed" when the user just needed to grant a permission and retry. The `NotAllowedError` branch now shows a dismissible, top-anchored notice instead, reusing the existing `.credential-toast` plain-div pattern (`ToastServiceHandler.showInfoToastByTranslateLabel()`) with a new `info` (blue) variant — every other camera error (not-readable, not-found, overconstrained, etc.) keeps the blocking alert, since those still need the user's full attention. Copy is unchanged (`errors.camera.not-allowed`), only the presentation.

## [3.14.0] - 2026-07-24

### Added

- **EUD-141 US-06 — Retrieve and sync the activity history in server mode**: `ActivityService` becomes mode-aware (the `WalletService.isBrowserMode()` pattern), consuming the new EBW backend (`GET`/`POST /api/v1/activity`) in server mode while keeping IndexedDB as a cache — not as the source of truth. `findAll()` in server mode performs a `GET`, overwrites the local cache with the response (server = source of truth, AC-03) and returns it; on a network failure it falls back to the existing cache without throwing or clearing it (AD-4, ES-04). New `syncFromServer()` (no-op in browser mode, ES-05) triggered after login in `login.page.ts`, at the same point where credentials are already synced (`WalletService.syncCredentials()`, called from `syncCredentialsThenNavigate()`/`syncCredentialCache()`) — recovers the history after local deletion or on a new device (AC-01/AC-02). `log()` still always writes to the local cache and, in server mode, also makes a best-effort `append()` to the server (silent on failure — an unsynced event is picked up on the next `syncFromServer()`/`findAll()`, AD-1). New `ServerActivityGateway` gateway (`list()`/`append()` via `HttpClient` + `UrlResolverService.serverUrl() + SERVER_PATH.ACTIVITY`) with an explicit bidirectional mapper between the client model (`'issued' | 'presented' | 'deleted'`) and the EBW backend contract (`ActivityType {ISSUED, PRESENTED, DELETED}`, snake_case JSON `credential_name`/`shared_attributes`/`created_at` — no client-supplied timestamp, the server always assigns `created_at`). No behavior change in browser mode (US-01..US-05 intact, ES-05).
- **EUD-141 — test coverage**: `server-activity.gateway.spec.ts` (new — `GET`/`POST` HTTP contract + type/field mapping, empty history, idempotency). `activity.service.spec.ts` extended with mode branching: recovery/sync overwriting the cache, offline fallback without mutating the cache on error (ES-04), non-blocking `log()` on `append()` failure (AD-1), and browser-mode guards (no gateway calls, ES-05). `activity.page.spec.ts` extended — read-only view with no manual sync control exposed (AC-07) and correct empty state when the history retrieved from the server is empty (EC-04). `login.page.spec.ts` updated with the `ActivityService` mock, aligned with the `syncCredentialsThenNavigate()` flow (EUD-104/3.13.1).
## [3.13.2] - 2026-07-24

### Added

- **Calidalia tenant**: added `'calidalia'` to `KNOWN_TENANTS` (`tenants.constants.ts`) so the tenant guard resolves the hostname instead of redirecting to `/tenant-not-found`.

## [3.13.1] - 2026-07-23

### Added

- **EUD-104 — frontend test coverage for associating a second device**: the passkey-setup step (`needsPasskeySetup`, driven purely by local `hasPasskey()` state) already handled the second-device case as part of EUD-103's onboarding flow — the frontend has no way to distinguish a first vs. a second device, since that distinction is entirely server-side (find-or-create). `login.page.spec.ts` extended with an explicit assertion that no navigation happens right after `verifyCode()` detects the absence of a local passkey (EC-01); the editable/default device name (AC-03/EC-02) and the `registerPasskey()` failure path (ES-02) were already covered by EUD-103's own test suite and needed no changes.

### Fixed

- **Credentials tab empty after login + false "no credentials available to login" on VP**: two symptoms with one root cause — the credential list was never reactive and the login-time sync was a non-atomic, fire-and-forget clear-then-refill. `WalletService.syncCredentialsOnLogin()` did `clearAllCredentials()` → fetch → `saveCredential()` per item, so a read landing between the clear and the re-fill saw an empty/partial store; the credentials tab took a one-time IndexedDB snapshot on a lifecycle hook and never self-corrected (had to switch tabs and return), and the OID4VP flow read a `CredentialCacheService` that was only populated on the success path of the old `loadCredentials()`, so a transient load error or an in-flight sync surfaced `errors.no-credentials-available` even when the holder had credentials.
  - `CredentialCacheService` is now the single **reactive source of truth** built on a `signal<{ status, credentials }>` (`idle`/`loading`/`loaded`/`error`), with `credentials`/`status` derived signals, a synchronous `snapshot()`, and mutators `setLoading`/`setLoaded`/`setError`/`patchStatus`/`remove`. `setError()` deliberately keeps the current list so a transient network failure never blanks the wallet. Matchers and `extractSignedJwt` are unchanged; dead `findCredentialsByType`/`syncFromBackend` removed.
  - `LocalCredentialStorageService.replaceAllCredentials()` writes clear + all puts in a **single IndexedDB transaction** (atomic swap). `WalletService.syncCredentialsOnLogin()` now fetches from the server **before** touching local storage, then swaps atomically, so IndexedDB is never observed empty mid-sync. New `WalletService.refreshCredentials()` reads the local store, normalizes it, and pushes state to the cache; it always completes (even on error) so callers can gate on it.
  - `CredentialsPage` renders from the reactive signals (skeleton/empty/list driven by `status`), and `verifiablePresentationFlow` **gates on `refreshCredentials()`**: a load _error_ shows `errors.loading-VCs` while a genuinely empty result shows `errors.no-credentials-available`. The racy constructor trigger was removed; status changes flow through `cache.patchStatus()`.
  - `LoginPage` marks the store `loading` before navigating and **awaits the sync only when a protocol deep link is pending** (VP / credential offer), so IndexedDB holds the server data before the VP flow runs; a normal login stays non-blocking and the tab fills in reactively.
- **Test coverage**: new `credential-cache.service.spec.ts` (reactive state + matchers); `wallet.service.spec.ts` updated for the atomic sync and `refreshCredentials` transitions; `credentials.page.spec.ts` covers the VP gate distinguishing load-error from empty; `login.page.spec.ts` covers the deep-link await vs. non-blocking sync.

## [3.13.0] - 2026-07-21

### Added

- **EUD-140 US-05 — Exportar el historial de actividad a CSV**: nuevo `ActivityExportService` (`providedIn: 'root'`) con un serializador CSV puro y sin dependencias — `buildCsv(entries, labels)` mapea un allow-list explícito de 5 columnas (`type` localizado, `credencial`, `contraparte`, `timestamp` en ISO 8601, `detalle`), excluyendo el `id` interno y cualquier otro campo del modelo (minimización, AC-04), sin reordenar columnas ni filas (AD-2/AD-4). Incluye escapado RFC 4180 (comillas dobladas para `,`/`"`/`\r`/`\n`) + BOM UTF-8 + separador `\r\n` (EC-01), neutralización de inyección de fórmulas anteponiendo `'` a valores de `credentialName`/`counterparty`/`details` que empiecen por `=`, `+`, `-`, `@`, TAB o CR (EC-02), y serialización defensiva ante campos vacíos/`type` desconocido o entradas malformadas, sin lanzar excepción ni abortar el resto de filas (EC-04, ES-01). `triggerDownload()` (`Blob` + `URL.createObjectURL` + ancla `download`, con `revokeObjectURL` en `finally`) y `buildFileName()` completan la descarga. `ActivityPage.exportHistory()` consume `entries()` (historial completo, no `filteredEntries()` — AD-1) sin mutar ninguna señal ni el filtro activo (AC-05, AC-06), y ante un fallo de descarga muestra un aviso i18n (`activity.export-error`) sin dejar archivo parcial (ES-03). Nuevo botón "Exportar historial" junto a "Borrar" en `.activity-header`, visible solo con eventos (`entries().length > 0`, ES-02). Nuevas claves i18n (`activity.export`, `activity.csv-header-*`, `activity.export-error`) en `es`/`en`/`ca`.
- **EUD-140 US-05 — test coverage**: `activity-export.service.spec.ts` (nuevo, 30 tests) cubre el serializador de forma aislada — estructura/cabecera/orden (AC-02), aislamiento/mapeo 1:1 (AC-03), minimización sin `id` (AC-04), RFC 4180 + BOM (EC-01), anti-inyección de fórmulas (EC-02), 200 filas en < 1 s (EC-03), campos opcionales vacíos (EC-04) y eventos malformados/`type` desconocido (ES-01). `activity.page.spec.ts` extendido (+21 tests) con la integración de botón/descarga: invocación de `buildCsv`+`triggerDownload` con el historial completo (AC-01), independencia del filtro activo (AC-05), ausencia de mutación/llamadas a `log()`/`clear()` (AC-06), disponibilidad del botón según haya historial (ES-02), toast de error ante fallo de descarga o de serialización (ES-03) y export de 200 entradas mixtas sin bloquear la interacción (EC-03, component-level).
- **EUD-139 US-04 — Ver el detalle de un evento de actividad**: `ActivityDetailComponent`, un modal Ionic read-only abierto desde `ActivityPage.openDetail(entry)` al pulsar (click o teclado, con `role="button"`/`aria-label`) cualquier `.activity-card`. Muestra credencial, contraparte (etiqueta según `issued`/`presented`, omitida si está ausente o el tipo no aplica), fecha absoluta y un resultado fijo "Completada". Para eventos `presented` añade una sección de atributos compartidos, con aviso explícito cuando no hay ninguno registrado. Sin controles de escritura — solo cerrar. Tipos de actividad desconocidos degradan a una etiqueta genérica en vez de lanzar excepción. Abrir y cerrar el modal no recarga ni muta `entries()` ni el filtro activo de la lista.
- **EUD-139 — captura de atributos compartidos en la presentación OID4VP**: `Oid4vpEngineService` deriva los nombres de los claims divulgados de una presentación SD-JWT (`deriveSharedAttributeNames`, vía `SdJwtParserService.reconstructClaims()`), excluyendo los claims registrados (`iss`, `iat`, `exp`, `cnf`, `vct`, `_sd*`), y los adjunta al registro de actividad `'presented'` (`ActivityEntry.sharedAttributes?: string[]`, nuevo parámetro opcional en `ActivityService.log()`). Cambio aditivo y no bloqueante: un fallo de parseo o una credencial no-SD-JWT degradan a "sin atributos" en vez de interrumpir la presentación.
- Extraídos `formatCounterparty`/`formatAbsoluteTime` de `ActivityPage` a `shared/utils/activity-format.util.ts`, reutilizados tanto por `ActivityPage` como por `ActivityDetailComponent`.

## [3.11.8] - 2026-07-17

### Added

- Accept legacy type "gx:LabelCredential" (added to the credential type list and its icon mapping) to allow displaying this type of credential.
- Show JWT and "copy" button for legacy "LEARCredentialMachine" and "gx:LabelCredential" credentials.

## [3.11.7] - 2026-07-16

### Fixed

- **Issuer metadata preload broken on custom domains**: after login, `RemoteAuthService` preloaded the OID4VCI issuer metadata from a hardcoded `${window.location.origin}/issuer`. On custom domains `/issuer` is not proxied same-origin (it returns the SPA's `index.html`), so the cache warm-up silently fetched the wrong resource. The issuer base URL is now resolved through `TenantService.resolveIssuerBaseUrl()`, which returns the same-origin `/issuer` on canonical domains and the issuer host declared in `custom-domain.json` on custom domains. The preload stays fire-and-forget and never breaks the login flow.

### Changed

- **Tenant resolution — environment moved to the second hostname segment**: the infrastructure no longer encodes the environment as a suffix of the first segment (`sandbox-stg.eudistack.net`); it now lives in a dedicated second segment (`sandbox.stg.eudistack.net`). `TenantService` no longer strips env suffixes — removed the `ENV_SUFFIXES` constant and the `stripEnvSuffix()` helper. `extractBaseTenantFromHostname()` now takes the first segment verbatim as the tenant id, and `buildFallbackUrl()` replaces only the first segment with the fallback tenant, preserving the environment segment automatically.

### Added - 2026-07-16

## [3.11.6] - 2026-07-16

- **EUD-144 US-02 — Self-revoke: reinforced confirmation, forced logout and re-onboarding**: `DevicesPage.deletePasskey()` now detects when the passkey being revoked belongs to the device currently in use (`isSelfRevoke`, matched against `PasskeyStoreService.getCredentialId()`) and shows a reinforced confirmation message (new i18n key `devices.delete-self-message`) instead of the standard one — a single conditional dialog per AD-1, not two separate flows. On a successful self-revoke, `PasskeyStoreService.clearCredentialId()` runs before `AuthService.forceLogout()`, so the forced logout routes the holder to re-onboarding (`/auth/register`) instead of login. Detection lives solely in the success (`next`) handler — a failed or timed-out revocation never forces a logout or clears local state. If the local credential id can't be resolved, the action fails safe to a regular (non-self) revoke.
- **EUD-144 US-02 — test coverage for device revocation**: `devices.page.spec.ts` extended with 20 new tests covering the full revoke flow — revoking another device (API call, dialog content, list update, session unaffected), self-revoke (reinforced message, `clearCredentialId` → `forceLogout` order, unresolved credential id fails safe), and error/edge cases (409 last-passkey message, cancelling the dialog, 5xx/timeout leaving the list and session untouched).

## [3.11.5] - 2026-07-16

### Fixed - 2026-07-16

- **OID4VP — holder key not found after page reload in browser mode**: `Oid4vciEngineService` used `crypto.randomUUID()` as the holder-key ID (introduced in 3.11.3 for EUDISTACK-645). In `PasskeyPrfKeyStorageProvider`, `isEphemeral()` matches any bare UUID and routes to `generateEphemeralKey()`, which stores the key only in an in-memory `Map` — never in IndexedDB. On page reload (or next session), `resolveKeyIdByKid()` queries IndexedDB and returns `null` → OID4VP throws `"No local key found for kid=<thumbprint>"`. Fixed by prefixing the holder-key ID with `holder-` so it does not match `UUID_PATTERN` and `generatePrfDerivedKey()` persists the key record to IndexedDB as intended.

## [3.11.4] - 2026-07-15

### Fixed

- **CGCOM — VCT rename `doctorid.sd.1` → `urn:es.cgcom:doctorid:1`**: updated `CredentialType`, `CredentialTypeMap`, and `VerifiableCredentialSubjectDataNormalizer` to use the canonical URN-based VCT, aligning the Wallet with the DoctorID issuer configuration and the CGCOM verifier DCQL profiles.

## [3.11.3] - 2026-07-14

### Fixed

- **EUDISTACK-645 — holder key shared across credentials of the same type**: `Oid4vciEngineService` derived the holder-key id as `${credentialIssuer}:${credentialConfigurationId}` (per credential _type_), so a holder receiving a second credential of the same type collided on the same key — a hard 409 in hybrid mode, a silent shared-key reuse in DB mode. Both violated ADR-021 (one holder key per credential, never shared). Now a `crypto.randomUUID()` is minted once per `performOid4vciFlow` call and used as the key id, restoring 1:1 `credential`:`holder_key`.

## [3.11.2] - 2026-07-10

### Added

- **EUD-137 US-02 — Activity history tests**: `activity.service.spec.ts` and `activity.page.spec.ts`, covering all 13 AC/EC/ES cases (0% → full coverage on both files), merged alongside EUD-138's filter test suite in the same spec file.

### Changed

- **EUD-137 US-02 — Verifier/Issuer legibility**: `formatCounterparty()` reduces URLs to hostname and truncates long `did:key` identifiers (e.g. `did:key:z6Mk…sdvktH`) instead of showing them raw. Wired into EUD-138's card subtitle (`activity.subtitle-issued`/`subtitle-presented`) so the normalized value, not the raw counterparty, is what gets interpolated into the translation.
- **EUD-137 US-02 — Activity UI polish**: "Clear" button enlarged and switched to the wallet's `color="danger"` convention.
- **EUD-137 — `ConfirmModalComponent` danger variant**: added `@Input() actionVariant: 'primary' | 'danger'` (`.btn-danger` style) so the "clear activity" confirmation renders its action button in red, matching the wallet's destructive-action convention; `ActivityPage.confirmClear()` passes `actionVariant: 'danger'`.

### Fixed

- **EUD-137 US-02 — Activity list not refreshing**: `ActivityPage` only loaded data on first tab entry; Ionic keeps tab pages alive, so events logged from other tabs (present/issue/delete) needed a manual page reload to show up. Added `ionViewWillEnter()` to reload on every re-entry.

## [3.11.1]

### Added

- **EUD-103 — editable device name during server-mode onboarding**: the passkey/device step of `LoginPage` now shows an editable `ion-input` prefilled with the auto-detected device name (e.g. "Windows PC", "iPhone"), with an associated `aria-label` (WCAG 2.1 AA). The value is trimmed, validated non-empty, and sent as `displayName` when the passkey is registered — before this, the name was fixed and never shown to the user (AC-05, EC-04).
- **EUD-103 — accessibility for `OtpInputComponent`**: added a translated `aria-label` per digit box ("Digit {i} of {n}") and an `aria-live="assertive"` region announcing verification errors (NFR-A-01).
- **EUD-103 — i18n**: added `auth.passkey.device-name-label`, `auth.passkey.device-name-placeholder` and `auth.errors.passkey-register-failed` to `en.json`, `es.json` and `ca.json`.
- **EUD-103 — test coverage for the server-mode onboarding flow**: `login.page.spec.ts` (new) covers the edited/default device name (AC-05/EC-04), resuming with a refresh token but no local passkey (EC-05), and recoverable errors on `register`/`verifyEmail`/passkey registration failures (ES-04/ES-05); `otp-input.component.spec.ts` (new) covers digit entry, paste, backspace/arrows, and the new accessibility attributes. This flow had no frontend test coverage before.

### Fixed

- **EUD-103 — `createPasskeyForDevice()` could leave a device with a local passkey but no server-side record**: it called `navigateHome()` and fired `registerPasskey(...)` in parallel, only logging (`console.warn`) if the server call failed — the user would land on the home screen believing the device was fully registered even when it was not. Reordered to register the passkey server-side first and navigate home only on success; on failure, an error is shown with the option to retry (AD-1, ES-05).

## [3.11.0] - 2026-07-10

### Added

- **EUD-138 US-03 — Activity filter control**: Added an `IonSegment`/`IonSegmentButton` control (scrollable) to `ActivityPage` with four options — "Todas" (default), "Recibidas", "Presentadas", "Eliminadas" — backed by the new `ActivityFilter` type and `ACTIVITY_FILTERS` constant in `activity.model.ts` (AC-01).
- **EUD-138 US-03 — Client-side filtering**: `ActivityPage` migrated to signals (`entries`, `loading`, `activeFilter`) with a `filteredEntries` computed that selects entries by `activeFilter()`, preserving the most-recent-first order returned by `ActivityService.findAll()`. Filtering is purely client-side and read-only: switching filters never calls `ActivityService.findAll()` again nor `clear()`/`confirmClear()`, and never mutates the `entries()` set (AC-02, AC-04).
- **EUD-138 US-03 — Contextual empty states**: Added a per-filter empty state (`activity.empty-issued` / `-presented` / `-deleted`) shown when the active filter has no matching events, reusing the existing `.state-container` pattern without error styling; the existing generic empty state (`activity.empty`) still shows when the whole history is empty under "Todas". The three render states (loading, generic empty, contextual empty, list) are mutually exclusive (AC-03, EC-01, EC-02).
- **EUD-138 US-03 — i18n**: Added `activity.filter-all`, `filter-issued`, `filter-presented`, `filter-deleted`, `empty-issued`, `empty-presented`, `empty-deleted` keys to `es.json`, `en.json`, `ca.json`.
- **EUD-138 US-03 — Tests**: Added component tests covering the filter control render and default ("Todas"), filtering/round-trip preserving order (AC-02, AC-03), read-only guarantees (AC-04), disjoint empty states (EC-01, EC-02), large datasets (200 entries / `MAX_ENTRIES`) and filter re-selection idempotence (EC-03, EC-04), and resilience to an unknown/missing entry `type` and to `findAll()` resolving `[]` (ES-01, ES-02).
- **EUD-138 US-03 — `ConfirmModalComponent`**: Replaced the native `AlertController` confirmation for "borrar historial" with a reusable custom modal (`src/app/shared/components/confirm-modal/`), parameterized via `@Input() icon`, `titleKey`, `descriptionKey`, `cancelKey`, `actionKey` so other features can present the same confirm/cancel pattern with their own copy — consumers pass those as `componentProps` to `ModalController.create()`, following the existing `TxCodeModalComponent` convention. Presented via `ModalController`, dismissing with role `confirm`/`cancel`; `ActivityPage.confirmClear()` now only calls `clearAll()` when the modal resolves with role `confirm`. Added `activity.clear-title`, `clear-description`, `clear-cancel`, `clear-action` i18n keys to `es.json`, `en.json`, `ca.json`, and matching styles in `theme/customAlert.scss` (`ion-modal.confirm-modal`).
- **EUD-138 US-03 — Activity list redesign**: `ActivityPage`'s history list migrated from `ion-list`/`ion-item` rows to a card-based layout (`activity-card` / `activity-card-content`), showing a contextual subtitle with the counterparty (`activity.subtitle-issued`, `subtitle-presented`) for received/presented entries. Added matching i18n keys to `es.json`, `en.json`, `ca.json`.

### Fixed

- **EUD-138 US-03 — `ActivityPage.setFilter` type safety**: `setFilter` now accepts `SegmentValue | undefined` (the type emitted by `IonSegment`'s `ionChange`) and only updates `activeFilter` when the value is a known member of `ACTIVITY_FILTERS`, avoiding an unsafe cast from an untyped segment change event.

## [3.10.2] - 2026-07-06

### Fixed

- **EUD-143 US-01 — Badge/icon invisible on tenants with a light `--primary-color`**: the "This device" badge and the device icon hardcoded `color: white` against a `background: var(--primary-color)`. `--primary-color` is tenant-themed by `ThemeService`; on tenants whose brand primary is white/near-white (e.g. `cgcom`), this rendered white text/icon on a white background. Found in production after merge (worked on `dome`, broken on `cgcom`). Replaced `white` with `var(--primary-contrast-color)`, the contrast token `ThemeService` already sets as a pair with `--primary-color` for every tenant.

## [3.10.1] - 2026-07-03

### Added

- **EUDISTACK-359 US-07:**
  - Added PRF support detection before starting hybrid onboarding.
  - Blocked onboarding when the authenticator does not support PRF.
  - Added onboarding block endpoint integration (`/block`) for unsupported PRF authenticators.
  - Prevented holder key generation and credential enrollment when PRF support is unavailable.
  - Added onboarding state handling and unit tests for PRF unsupported and inconclusive scenarios.

### Fixed

- **EUDISTACK-534 US-02 — hybrid key generation was never wired to the SPI**: `HybridKeyStorageProvider.generateKeyPair()` delegated to `ServerKeyStorageProvider` (the DB-only `/api/v1/keys/generate` endpoint), which always 403s for `key_manager=hybrid` tenants. Now delegates to the new `HybridKeyEnrollmentService`, orchestrating init → single PRF ceremony → key generation → inline OID4VCI proof signing → wrap → commit → zeroize, and returns `prebuiltJwsProof` so the OID4VCI engine never needs `sign()` for issuance.
- **EUDISTACK-534 US-02 — `holder_key_id` overflow**: `generateKeyPair()` returned the OID4VCI engine's `keyId` (`credentialIssuer:credentialConfigurationId`) as the SPI `keyId`, overflowing `wallet_credential.holder_key_id VARCHAR(36)` (`PostgresqlBadGrammarException` 22001). Now returns `context.credentialId` (still round-trips via `resolveKeyIdByKid`); backend column widened to `VARCHAR(512)` (see companion `eudistack-core-wallet-ebw` migration `V5`).
- **EUDISTACK-534 US-02 — `OnboardingHybridApi` used the wrong base URL**: read `environment.server_url` directly instead of `UrlResolverService`, producing a relative path missing the `/business-wallet` nginx prefix (404) in real deployments where `server_url` is empty by design. Fixed to match the existing `HybridAuditService` pattern. Same latent bug preventively fixed in `SignApi`.
- **EUDISTACK-534 US-02 — double PRF/WebAuthn prompt per credential**: `HybridKeyEnrollmentService.enroll()` ran `detectPrfSupport()` (a separate dummy-salt probe) before `evaluateForWrap()` (the real ceremony), forcing two passkey prompts. `evaluateForWrap()`'s own `hybrid.error.prfUnavailable` failure is an equally valid "unsupported" signal that still fires before any key material exists — merged into a single ceremony.
- **EUDISTACK-536 US-04 — `buildPresentationJws()` was never wired to the SPI**: threw `HybridAdapterError` unconditionally. Now delegates to `SignService.sign()`, driving the prepare/PRF-unwrap/sign/submit handshake for OID4VP presentations.
- **EUDISTACK-536 US-04 — `prepareSign` contract corrected** (architecture.md §6.2, 2026-07-03): `vp_challenge` → `payload`, the full presentation payload assembled by the OID4VP engine, matching the corrected EBW contract. A KB-JWT built from `{nonce, iat}` alone (the old contract) is invalid per RFC 9901 §4.1.2 (missing `aud`/`sd_hash`).
- **Security (2026-07-06 audit) — signing oracle**: `SignService.sign()` signed the `signing_input` returned by the EBW without verifying it encoded the `payload` actually submitted; a compromised/malicious EBW could substitute different claims and get a valid holder signature over content it chose. Now verifies header (`alg`/`typ`) and payload (order-independent) match before ever running the PRF ceremony.
- **Security (2026-07-06 audit) — raw PRF output not zeroized**: `HybridKeyEnrollmentService.enroll()` never zeroed the raw PRF output (IKM) after deriving the wrap key. Now zeroed in `finally`, matching `SignService`.
- **Security (2026-07-06 audit) — PRF zeroize skipped on error path**: `SignService.sign()`'s cache-miss path only zeroed the raw PRF output on success. Now zeroed in `finally`.
- **Security (2026-07-06 audit) — AES-GCM `usages` cache-reuse bug**: `WrapService.deriveWrapKey()`/`UnwrapService.deriveUnwrapKey()` derived single-purpose keys (`['wrapKey']`/`['unwrapKey']`), but `MemoryService` caches the same key under `credentialId` across both the enrollment (write) and signing (read) flows — a cache-hit cross-use threw `InvalidAccessError`, mislabeled by `UnwrapService.unwrap()`'s catch-all as `wrap_unavailable_on_this_device` ("wrong device"), sending holders down the wrong recovery path for a WebCrypto API bug, not a passkey mismatch. Fixed: both derive with `['wrapKey', 'unwrapKey']`; `unwrap()`'s catch now only maps a genuine `OperationError` (bad GCM tag) to that error code, anything else to `prepare_sign_failed`.

### [3.8.11] - (2026-06-17)

### Added

- **EUDISTACK-534 US-02 — `hybrid-keymanager` feature module**: new `src/app/features/hybrid-keymanager/` module implementing client-side holder key generation, PRF-based wrap, and hybrid onboarding commit.
- **EUDISTACK-534 US-02 — `MemoryService`**: in-memory `Map<credentialId, CryptoKey>` cache for AES-256-GCM wrap keys. TTL=5 min via `setTimeout`; `SubtleCrypto.deleteKey` called on eviction and `beforeunload`. No write to `localStorage`/`sessionStorage`/IndexedDB (AC-02, EC-01, EC-02).
- **EUDISTACK-534 US-02 — `PrfClientService`**: thin wrapper over `PasskeyPrfService.getCredentialId()` that evaluates the WebAuthn PRF extension with a server-supplied salt. Returns raw 32-byte PRF output; throws `AppError` if no passkey is registered, assertion is cancelled, or PRF output is absent (AC-01, ES-04).
- **EUDISTACK-534 US-02 — `WrapService`**: `generateHolderKeyPair` (ECDSA P-256, extractable private key); `deriveWrapKey` (HKDF-SHA-256, `salt=credentialId`, `info="hybrid-wrap-v1"`, L=256); `wrapPrivateKey` (AES-256-GCM, random 12-byte IV, 16-byte tag split from output); `zeroize` (best-effort `deleteKey`). `cnf.jwk` never contains private parameter `d` (AC-02, AC-03, EC-03, NFR-05).
- **EUDISTACK-534 US-02 — `OnboardingHybridApi`**: typed HTTP client for `POST /api/v1/keys/hybrid/onboarding/init` and `POST /api/v1/keys/hybrid/onboarding/commit`. DTOs aligned with EBW backend contract (AC-03, AC-04).
- **EUDISTACK-534 US-02 — `OnboardingHybridComponent`**: orchestrates init → PRF ceremony → key generation → HKDF derivation → AES-GCM wrap → commit → zeroize. `try/finally` guarantees private key is always zeroized; wrap key cached on success, zeroized on error. Aborts before commit if PRF ceremony fails (AC-01, AC-02, AC-08, ES-04, ES-05).
- **EUDISTACK-534 US-02 — Unit tests**: `memory.service.spec` (TTL eviction, `beforeunload`, no-persistence); `prf-client.service.spec` (salt propagation, AppError paths); `wrap.service.spec` (ECDSA P-256, HKDF, AES-GCM, unique IVs, no `d` in JWK, zeroize); `onboarding-hybrid.component.spec` (full flow, commit body public-only, ES-04 abort, ES-05 zeroize invariants).

### Added

- **EUD-143 US-01 — List registered devices**: Added display of `lastUsedAt` (with explicit "Never used" fallback for null values) in the Devices page.
- **EUD-143 US-01 — Current device identification**: Added "This device" textual badge (WCAG 2.1 AA compliant) to the Devices list, mapping `currentCredentialId` with the passkey's `credentialId`.
- **EUD-143 US-01 — i18n**: Added `devices.last-used`, `devices.last-used-never` and `devices.this-device` keys to `en.json`, `es.json` and `ca.json`.

### Changed

- **EUD-143 US-01 — Devices list layout**: each device now renders as its own separate card (background, rounded corners, spacing between entries) instead of all devices sharing one continuous card with row separators.

### Fixed

- **EUD-143 US-01 — undefined `--action-primary` CSS variable**: the "This device" badge and the device icon on the Devices page referenced `var(--action-primary)`, a token that does not exist in `theme/variables.scss` (only `--primary-color` is defined). The undefined variable made `background` resolve to nothing, rendering the badge as invisible white text and the device icon as an empty circle. Found during manual QA of AC-03. Replaced both usages with `var(--primary-color)`.
- **EUD-143 US-01 — Devices page subtitle not centered**: `.devices-subtitle` had no `text-align`, so it rendered left-aligned while the empty/loading/error states below it are centered. Added `text-align: center` for visual consistency. Found during manual QA of AC-05.
- **EUD-143 US-01 — Duplicate page header leaving a blank bar**: `DevicesPage` was the only screen in the app defining its own `<ion-header>`/`<ion-toolbar>`, rendered as a second, empty bar below the app's shared header (no other page under `/tabs/*` defines one). Removed it; the page no longer shows a blank strip below the header.

## [3.9.2] - 2026-06-29

### Added

- **EUDISTACK-538 US-06 — `HybridOnboardingPage`**: multi-step acceptance wizard shown to holders on hybrid tenants before any key operation. Guard (`hybridOnboardingGuard`) intercepts `tabs` activation when `key_manager=hybrid` and the session flag is absent; inverse guard (`hybridOnboardingRouteGuard`) prevents direct access on non-hybrid tenants. Route: `/hybrid-onboarding`.
- **EUDISTACK-538 US-06 — `HybridAuditService`**: calls `POST /api/v1/keys/hybrid/constraint-accepted` after the holder taps "accept". Fire-and-forget with `catchError`; navigation to `/tabs` proceeds regardless of backend availability.
- **EUDISTACK-538 US-06 — `HybridOnboardingService`**: sessionStorage-backed flag (`hybrid-onboarding-accepted`) so the wizard is shown once per session.
- **EUDISTACK-538 US-06 — `HybridAdapterError`**: typed error class extending `AppError` with codes `wrap_unavailable_on_this_device` | `prepare_sign_failed`. `AppError` union type updated accordingly.
- **EUDISTACK-538 US-06 — `HybridKeyStorageProvider`**: Angular DI provider for hybrid mode. Key generation delegates to `ServerKeyStorageProvider`; `sign()` is a typed stub pending US-04 (EUDISTACK-536). `key-storage.provider.factory.ts` selects this provider when `mode=server` and `keyManager=hybrid`.
- **EUDISTACK-538 US-06 — `SignPromptComponent`**: error display component for `wrap_unavailable_on_this_device` failures — shown when the holder attempts to sign from a device that does not hold the PRF-bound key.
- **EUDISTACK-538 US-06 — i18n**: `hybrid-onboarding.*` and `hybrid-errors.*` keys added to `es.json`, `en.json`, `ca.json`.
- **`jest.config.js`**: extended `collectCoverageFrom` to include the new hybrid onboarding/signing components and related core services/guards in coverage reporting.

## [3.9.1] - (2026-06-23)

### Changed

- Updated custom-domain.json model.

## [3.9.0] - (2026-06-17)

### Added

- **EUDISTACK-534 US-02 — `hybrid-keymanager` feature module**: new `src/app/features/hybrid-keymanager/` module implementing client-side holder key generation, PRF-based wrap, and hybrid onboarding commit.
- **EUDISTACK-534 US-02 — `MemoryService`**: in-memory `Map<credentialId, CryptoKey>` cache for AES-256-GCM wrap keys. TTL=5 min via `setTimeout`; `SubtleCrypto.deleteKey` called on eviction and `beforeunload`. No write to `localStorage`/`sessionStorage`/IndexedDB (AC-02, EC-01, EC-02).
- **EUDISTACK-534 US-02 — `PrfClientService`**: thin wrapper over `PasskeyPrfService.getCredentialId()` that evaluates the WebAuthn PRF extension with a server-supplied salt. Returns raw 32-byte PRF output; throws `AppError` if no passkey is registered, assertion is cancelled, or PRF output is absent (AC-01, ES-04).
- **EUDISTACK-534 US-02 — `WrapService`**: `generateHolderKeyPair` (ECDSA P-256, extractable private key); `deriveWrapKey` (HKDF-SHA-256, `salt=credentialId`, `info="hybrid-wrap-v1"`, L=256); `wrapPrivateKey` (AES-256-GCM, random 12-byte IV, 16-byte tag split from output); `zeroize` (best-effort `deleteKey`). `cnf.jwk` never contains private parameter `d` (AC-02, AC-03, EC-03, NFR-05).
- **EUDISTACK-534 US-02 — `OnboardingHybridApi`**: typed HTTP client for `POST /api/v1/keys/hybrid/onboarding/init` and `POST /api/v1/keys/hybrid/onboarding/commit`. DTOs aligned with EBW backend contract (AC-03, AC-04).
- **EUDISTACK-534 US-02 — `OnboardingHybridComponent`**: orchestrates init → PRF ceremony → key generation → HKDF derivation → AES-GCM wrap → commit → zeroize. `try/finally` guarantees private key is always zeroized; wrap key cached on success, zeroized on error. Aborts before commit if PRF ceremony fails (AC-01, AC-02, AC-08, ES-04, ES-05).
- **EUDISTACK-534 US-02 — Unit tests**: `memory.service.spec` (TTL eviction, `beforeunload`, no-persistence); `prf-client.service.spec` (salt propagation, AppError paths); `wrap.service.spec` (ECDSA P-256, HKDF, AES-GCM, unique IVs, no `d` in JWK, zeroize); `onboarding-hybrid.component.spec` (full flow, commit body public-only, ES-04 abort, ES-05 zeroize invariants).

## [3.8.11] - 2026-06-19

### Added

- **`IssuerMetadataCacheService.fetchAndCacheIfMissing(issuerUrl)`**: preloads the OID4VCI metadata of the wallet's own issuer right after a successful token exchange in `RemoteAuthService.handleTokenResponse`. Guarantees that credentials presented via OID4VP (including legacy ones migrated from another wallet or restored from backup) can resolve their display metadata (Mandator, Mandatee…) even when they were never accepted through the standard OID4VCI flow.

### Changed

- **`CREDENTIAL_TYPES_ARRAY`**: added `LEARCredentialEmployee` and `LEARCredentialMachine` aliases so the wallet recognises real DOME legacy credentials (which carry the bare semantic type in `type[]` instead of the versioned `learcredential.<role>.w3c.<n>` identifier). Required for display, selection and presentation flows during the DOME sunset window.

### Fixed

- **OID4VP — Holder JWK fallback chain** (`Oid4vpEngineService.resolveHolderJwk`): when the selected credential lacks `cnf.jwk`, the engine now derives the holder public key from `cnf.kid` (legacy SD-JWT format with a `did:key` URI) or from `vc.credentialSubject.mandate.mandatee.id` (W3C VCDM) before bailing out. Aligns the wallet with the same fallback chain used by the verifier's `CryptographicBindingValidator`, enabling presentation of DOME legacy credentials that do not embed the holder JWK explicitly.

## [3.8.10] - 2026-06-18

### Fixed

- **OID4VCI authorization code flow — DOME cross-origin**: revert browser-navigation and popup workarounds (PR #126, #127). The root fix is in `eudistack-core-issuer`: `CorsWebFilter` now runs as a standalone bean at highest precedence, guaranteeing `Access-Control-Allow-Origin` on the 302 response from `/oid4vci/v1/authorize`. The wallet restores the original XHR-based approach (`HttpClient.get` + `response.url`), which works without browser navigation or popups.

## [3.8.7] - 2026-06-18

### Changed

- **URL resolution — removed canonical/non-canonical branching**: `UrlResolverService` no longer checks `isCanonicalDomain()` to pick between `/business-wallet/` and bare-origin paths. `serverUrl()` and `websocketUrl()` always apply the `/business-wallet` prefix (env override via `server_url` / `websocket_url` still wins). `walletDiscoveryPath()` method removed; its value is now the compile-time constant `WALLET_DISCOVERY_PATH` in `api.constants.ts`. All consumers (`authInterceptor`, `HttpErrorInterceptor`, `HttpWalletDiscoveryGateway`) updated accordingly.

## [3.8.5] - 2026-06-18

### Changed

- Remove cross-tenant offer validation

## [3.8.5] - 2026-06-17

### Fixed

- **OID4VP — W3C VC presentation**: `Oid4vpEngineService` now resolves the holder ID from both VCDM 1.1 (`payload.vc.credentialSubject.id`) and VCDM 2.0 (`payload.credentialSubject.id`) JWT structures before falling back to the `sub` claim. Previously, credentials issued in VCDM 2.0 format (no `vc` wrapper) always failed with "Missing holder id in selected credential".

## [3.8.4] - 2026-06-17

### Changed (2026-06-17)

- **Wallet API URL resolution** is resolved with the appropiate canonical or non-canonical URL.
- Updated custom-domain.json model.

## [3.8.3] - 2026-06-15

### Added (2026-06-15)

- Added `cgcom` to the list of known tenants.
- **Custom-domain tenant resolution (`TenantService`)**: the app now resolves the active tenant via a two-step lookup — first from the hostname subdomain (existing behaviour), then from `/assets/tenants/custom-domain.json` (a `{ "hostname": "tenantId" }` map) when the subdomain does not match a known tenant. The resolved tenant (or `null` for unknown origins) is stored in a `Signal<string | null>` initialised before theme loading and consumed by `ThemeService`, `tenantGuard` and `TenantNotFoundPage`.

### Changed (2026-06-15)

- **`tenants.constants.ts`**: reduced to data-only (`KNOWN_TENANTS`, `FALLBACK_TENANT`); resolution functions moved to `TenantService` as private methods.
- **`tenantGuard`**, **`tenantNotFound`**, **`credentialOfferService`**: read the resolved tenant signal from `TenantService` instead of re-deriving it from the hostname on every navigation.
- **Service Worker cache (`ngsw-config.json`)**: `/assets/tenants/custom-domain.json` added to the `config` freshness group (1 h TTL, maxSize increased to 10).

## [3.8.2] - 2026-06-08

### Fixed

- **Auth interceptor — token expiry**: `authInterceptor` now intercepts 401 responses from the own-backend and calls `forceLogout()`, redirecting the user to the login screen. Previously, an expired access token returned a raw 401 error with no session cleanup — the user saw an error but was never redirected.

## [3.8.1] - 2026-06-03

### Fixed

- **`WalletDiscoveryService`**: changed discovery endpoint from `/.well-known/wallet-config-metadata` to `/business-wallet/.well-known/wallet-config-metadata` to align with EBW base-path and eliminate the need for special nginx/CloudFront routing.
- **Auth — browser mode register**: `LoginPage` now shows "Create Passkey" button (`LocalAuthService.setupPasskey()`) on `/auth/register` when no passkey exists on the device, instead of incorrectly showing "Sign in with Passkey".
- **Auth — browser mode titles/subtitles**: corrected per-state titles and subtitles for both login and register states in browser mode.
- **Auth — server mode step 3b**: passkey setup on a new device (step 3b) now shows "Register your device" title instead of "Welcome back".

## [3.8.0] - 2026-06-02

### Added

- **Server-side wallet mode** (`wallet_mode=server`): `key-storage.provider.factory.ts` dynamically selects `ServerKeyStorageProvider` when the EBW reports server mode, keeping `PasskeyPrfKeyStorageProvider` for browser mode. No change to browser-mode behaviour.
- **`ServerKeyStorageProvider`**: full implementation — `generateKeyPair` sends OID4VCI context (`format`, `supported_algs`, `issuer_identifier`, `c_nonce`) to `POST /api/v1/keys/generate`; `buildPresentationJws` delegates KB-JWT and VP-envelope signing to `POST /api/v1/keys/{keyId}/sign`; `resolveKeyIdByKid` resolves key IDs from `GET /api/v1/credentials`.
- **OID4VCI issuance (server mode)**: `oid4vci.engine` passes `OID4VCIKeyGenContext` to `generateKeyPair` and uses the pre-built `jws_proof` returned by the EBW directly — no local signing step.
- **OID4VP presentation (server mode)**: `oid4vp.engine.signJwt` delegates full JWS construction to `buildPresentationJws` when available, keeping the existing browser-mode path intact.
- **`FinalizeIssuancePayload`**: new optional fields `holderKeyId` and `holderKid` propagate the EBW key reference through the issuance flow so the credential can be linked server-side.

### Changed

- **Unified auth UI**: both `/auth/login` and `/auth/register` routes now load `LoginPage` (single component). Entry screen title changed to "Register your device"; passkey step title is "Welcome back".
- **i18n** (`en.json`, `es.json`, `ca.json`): 10 unused `auth.register.*` keys removed; `auth.login.title-welcome` added for the passkey step.

### Fixed

- **`DpopService`**: always uses `PasskeyPrfKeyStorageProvider` for ephemeral DPoP keys regardless of `wallet_mode` — prevents accidental routing to the EBW's holder-key endpoint.

### Removed

- **`RegisterPage`** (`register.page.ts`, `register.page.scss`) — replaced by unified `LoginPage`. 693 lines removed.

## [3.7.4] - 2026-05-31

### Fixed

- **`dayjs` imports**: migrated from named to default import across `credential-verification.service.ts`, `credentials.page.ts` and `vc-view.component.ts` to align with the CommonJS module format of `dayjs`.
- **`tsconfig.json`**: enabled `esModuleInterop` and `allowSyntheticDefaultImports` to support default imports from CommonJS modules without compile errors.

## [3.7.3] - 2026-05-28

### Fixed

- **Wallet discovery URL** (`HttpWalletDiscoveryGateway`): use `window.location.origin` as base
  for the well-known endpoint instead of a hardcoded prefix that broke cross-origin deployments.
- **`WalletConfigMetadataDto`**: remove stale fields (`version`, `natural_persons_only`,
  `supported_credentials`) and align DTO to the current EBW contract
  `{ wallet_mode, key_manager }` (EUDISTACK-412 / EUDISTACK-119).

## [3.7.2] - 2026-05-28

### Changed

- Migrated Angular build target from the legacy `browser` builder to the `application` builder (`@angular-devkit/build-angular:application`), aligning with the Angular 19 default and producing the `browser/` output subfolder expected by CI/CD.

## [3.7.1] - 2026-05-19

### Changed

- Accept gx.labelcredential.w3c.2 instead of gx.labelcredential.w3c.1.

## [3.7.0] - 2026-05-18

### Added

- **Wallet mode discovery** (EUDISTACK-502, US-009): new `WalletDiscoveryService` resolves
  `wallet_mode` at runtime by calling `GET /business-wallet/.well-known/wallet-config-metadata`
  before any Angular route activates. Implemented as an `APP_INITIALIZER` (AD-1). Result is
  stored in a reactive signal, exposed via `mode()` for synchronous downstream reads (AC-009.5b).
- `HttpWalletDiscoveryGateway`: HTTP adapter for the EBW well-known endpoint with a 2 s defensive timeout (AC-009.4c)
  and shape validation (AC-009.2, AC-009.3).
- `walletDiscoveryInitializer`: `APP_INITIALIZER` factory — never rejects; falls back silently
  on any network or HTTP error (AC-009.4, AD-2).
- Silent fallback chain: well-known failure → `environment.wallet_mode` → default `'browser'`
  (AC-009.4a–e, AD-5). Emits `console.warn` + telemetry on every fallback.
- Discovery result is memoized per session — exactly one HTTP request regardless of route
  navigation count (AC-009.5a, AD-3).

### Changed

- `AUTH_SERVICE_PROVIDER`: migrated `wallet_mode` read from static `environment.wallet_mode`
  to `WalletDiscoveryService.mode()` (AC-009.6).
- `WalletService.isBrowserMode`, `SettingsPage.isServerMode`, `DevicesPage.isServerMode`:
  same migration — all downstream consumers now read from the resolved signal (AC-009.6).
- Service Worker (`ngsw-config.json`): added `well-known-ebw` data group with freshness
  strategy to prevent the SW from serving a stale discovery response from cache (AC-009.1).

## [3.6.9] - 2026-05-18

### Fixed

- Fixed the Send Logs button flow on Safari and installed PWA contexts.

## [3.6.8] - 2026-05-18

### Fixed

- Ensure cards are visible and add `ionViewWillEnter` lifecycle method for loading credentials

## [3.6.7] - 2026-05-14

### Fixed

- Updated the credential selection message on the vc-selector page.
- Added a white background behind the logo when no dark-mode compatible RP Metadata logo is available, improving visibility in fallback scenarios.

## [3.6.6] - 2026-05-13

### Fixed

- Settings: "Wallet type" and "About" are now displayed as static text, not tappable rows.
- VC select: renamed screen title from "Credential Request" to "Select Credential" (en).

## [3.6.5] - 2026-05-13

### Fixed

- QR scanner frame now correctly matches the camera video size on desktop

## [3.6.4] - 2026-05-13

### Added

- **VC Selector**: Integrated verifier information display within the `vc-selector` view to improve transparency during credential selection.
- **Testing**: implemented new test suites for `vc-selector` page specifically targeting metadata rendering and edge cases.
- Added 5 new tests for single-instance service to cover the new logic for installed PWA and follower notification.

### Fixed

- **Single-instance:** Ensure installed PWA shows the duplicate-instance UI instead of silently closing; follower now notifies leader and renders a contextual message in standalone mode.

## [3.6.3] - 2026-04-30

### Fixed

- **iOS onboarding step 1 — corrected icon and copy to "three dots"** (EUDI-045 US-008).
  Step 1 of the install wizard previously described the Safari more-options control as a
  "down arrow" (`chevron-down-outline` icon). On modern iOS Safari, the actual control is
  a three-dots ellipsis button next to the address bar. Icon changed to `ellipsis-horizontal`
  and copy reworded in `en.json`, `es.json`, `ca.json` to match the real control name and
  position. Files: `ios-install-onboarding.page.ts`, `src/assets/i18n/{en,es,ca}.json`.

## [3.6.2] - 2026-04-30

### Fixed

- WCAG 2.1 AA compliance improvements (PRB-002 F-H08). Added missing ARIA attributes to icon-only buttons/images, hid decorative icons from screen readers, and fixed heading hierarchy in settings.

## [3.6.1] - 2026-04-30

### Changed

- **iOS PWA install onboarding wizard — refined steps for credential offer flow (EUDI-045 US-008)**.
  Wizard now guides the user end-to-end from "open the email link in Safari" all the way to the wallet
  receiving the credential. Step list reworked to:
  1. Tap the down arrow in Safari (open the options menu — replaces the previous "tap Share" first step,
     which was misleading on iOS layouts where Share is hidden inside the more-options menu)
  2. Tap the Share button
  3. Tap "Add to Home Screen"
  4. Tap "Add"
  5. Open Wallet from your home screen
  6. Scan the QR from inside Wallet
     Step 6 explicitly tells the user to use Wallet's `Escáner QR` / `QR Scan` option — not the iPhone
     native camera — because scanning from the OS camera reopens Safari and loses the offer due to the
     Safari ↔ standalone storage isolation. Title and subtitle updated to frame the wizard as the
     credential activation flow rather than a generic install prompt. i18n keys renumbered `step1`–`step6`
     in `en.json`, `es.json`, `ca.json`.

- **QR scan support for `authorization_request=` URLs (proximity verifier same-device flow)**
  (`credentials.page.ts`). `qrCodeEmit()` now extracts the inner `openid4vp://` URI from
  HTTPS callback URLs that carry it as the `authorization_request` query parameter (the format the
  proximity verifier puts in its QR codes). Previously these URLs were rejected by
  `isSupportedQrContent` because `request_uri=` was URL-encoded inside the query value, which made
  the literal-substring check miss. Pattern added: `qrCode.includes('authorization_request=')`.

## [3.6.0] - 2026-04-29

### Added

- **iOS PWA install onboarding wizard (EUDI-045 US-008)** — iOS Safari users in browser mode are now gated by a 4-step wizard before reaching the auth flow. The wizard explains how to add the wallet to the home screen via Safari's "Add to Home Screen" option, preventing data loss caused by iOS standalone PWA storage isolation (IndexedDB, localStorage, and cookies are fully isolated from the Safari browser context). Detection excludes Chrome iOS (`CriOS`), Firefox iOS (`FxiOS`), and Edge iOS (`EdgiOS`), since only Safari can install PWAs on iOS. Users who have already bootstrapped their wallet (`PasskeyStoreService.hasPasskey()`) see an adapted variant reminding them to reopen from the home screen icon. A "Continue anyway" escape hatch is available via confirmation dialog; dismissal is session-scoped (`sessionStorage`) so the wizard reappears on the next visit.
- **Telemetry stub** — anonymous telemetry events (`ios_onboarding_shown`, `ios_onboarding_dismissed`, `ios_pwa_installed`) logged in dev mode via `TelemetryService`; no-op in production until a backend endpoint is wired.
- **Standalone divergence banner** — in server mode, if the wallet is opened in standalone but has no passkey stored, a contextual warning banner is shown on the register page informing the user of the storage isolation risk (AC-008.8).
- **i18n** — new `ios-install.*` keys added to `en.json`, `es.json`, and `ca.json`.

## [3.5.0] - 2026-04-28

### Added

- Add tests for single-instance and auth service.
- Unit tests for `CredentialOfferService` tenant validation.

### Fixed

- **PasskeyPrf key storage** — wallet always uses `PasskeyPrf` key storage until EUDI-041 (key management) is ready, preventing fallback to weaker storage in server mode.
- **Passkey handling for device registration** — improved passkey flow and user-facing error states during device registration to avoid dead-ends when the authenticator interaction fails.
- **OTP input** — removed spurious `completed` event emission that triggered double-submit in some flows.
- **`settings.page.spec.ts`** — added `ThemeService` stub (null snapshot) to `TestBed`. The spec was failing in CI with `NullInjectorError: No provider for HttpClient` since commit 596f3a0 because `ThemeService` injects `HttpClient` and the spec did not provide it.
- **OID4VCI `redirect_uri` multi-tenant** — removed the build-time `OID4VCI_REDIRECT_URI` variable. The same bundle is deployed to all tenants and `redirect_uri` is now derived at runtime from `window.location.origin`. Root cause of the reported 504: the hardcoded host (`wallet-stg.altia.eudistack.net`) did not resolve in DNS after EUDI-094.
- **Multi-tab (Single Instance)** — fixed infinite login redirection loop in the main tab when a second Wallet tab was opened; secondary tab now correctly detects the leader and halts cleanly without corrupting session tokens.

### Changed

- **PRF handling streamlined** — refactored PRF key derivation path to consolidate biometric prompt triggers; duplicate prompts in multi-step flows eliminated.
- **Logout process** — streamlined logout to clear session state in a single pass; removed intermediate redirect steps that caused flicker on some devices.
- **Registration and login pages** — removed steps bar component; replaced with inline progress cues to reduce visual noise.
- **Button styles** — updated primary/secondary button styles for consistency across auth screens.
- **Wallet API URLs derived from `window.location`** — `server_url` and `websocket_url` are now derived from the origin at runtime. This allows the same bundle to serve all tenants, assuming CloudFront/nginx proxies `/business-wallet/*` to the corresponding tenant's EBW.
- **Multi-tab single-instance** — simplified single-instance handling: removed unreliable cross-tab focus attempts; duplicate tabs now show a clear "close this tab" UI; deep-links are processed by the already-open tab.

## [3.4.0] - 2026-04-28

### Added

- **Cross-tenant credential offer validation** — `CredentialOfferService` now validates that the credential offer belongs to the current tenant, rejecting cross-tenant offers with a dedicated error message and i18n keys.
- **Session master handling for PRF** — implements session master key derivation to reuse existing PRF material across operations, reducing the number of biometric prompts required per session.
- **Registration flow `mode` parameter** — registration route accepts a `mode` query param to distinguish device-passkey vs browser flows; UI text updated accordingly for clearer user guidance.
- **Settings → Wallet type badge** — la página de Ajustes muestra ahora un indicador del modo del wallet (`EUDIW` cuando `wallet_mode === 'browser'`, `Business Wallet` cuando `wallet_mode === 'server'`). Permite al usuario distinguir de un vistazo en qué tipo de wallet está operando, alineado con la documentación pública (`docs.eudistack.net`).
  - `settings.page.{ts,html}` — nuevo `walletModeKey` y `<ion-badge>` justo encima del item _About_.
  - `i18n/{en,es,ca}.json` — claves `settings.wallet-mode-label`, `wallet-mode-eudiw`, `wallet-mode-business`.
- **Settings → Knowledge base link** — item visible cuando el `theme.json` del tenant define `content.knowledgeBaseUrl`. Todos los tenants EUDIStack ahora apuntan a `https://docs.eudistack.net` (excepto DOME, que mantiene su KB propia).

### Fixed

- **`appVersion` hardcoded a 3.0.0** — `environment{,.production}.ts` y `package.json` desincronizados desde hace varias releases; _About_ siempre mostraba `v3.0.0` independientemente del bundle desplegado. Bumpeado a `3.4.0` en los tres ficheros (follow-up: derivar `appVersion` de `package.json` en build-time para no volver a olvidarlo).
- **`settings.page.spec.ts`** — añadido stub de `ThemeService` (snapshot null) en el `TestBed`. El spec fallaba en CI con `NullInjectorError: No provider for HttpClient` desde el commit 596f3a0 (knowledge base link), porque `ThemeService` inyecta `HttpClient` y el spec no lo proveía.

### Changed (Wallet API URLs derived from window.location — multi-tenant)

- **`env.template.js`** / **`environment.production.ts`** — `server_url` y `websocket_url` ahora se derivan del origin en runtime (`${window.location.origin}/business-wallet` y variante `ws(s)://` para el WebSocket). Permite que el mismo bundle sirva a todos los tenants (`sandbox-stg`, `kpmg-stg`, `dome-stg`, …) asumiendo que CloudFront/nginx proxya `/business-wallet/*` al EBW del tenant correspondiente (EBW expondrá `/business-wallet/api/v1/...` cuando entre en producción).
- **`.github/workflows/deploy.yml`** — eliminadas `WALLET_API_EXTERNAL_URL` y `WALLET_API_WEBSOCKET_EXTERNAL_URL` del paso de generación de `env.js`. GitHub Variables borradas en el entorno `stg`.
- **`src/assets/env.js`** — comentado que en dev local se mantiene el override explícito hacia `http://localhost:8083/wallet`.
- ⚠️ EBW no activo en sandbox-stg todavía; cuando se despliegue deberá responder bajo `/business-wallet/api/*` en el mismo origin del SPA por tenant.

### Changed (Multi-tab single-instance)

- Simplified single-instance handling: removed unreliable cross-tab focus attempts and now duplicate tabs show a clear "close this tab" UI; deep-link routing was fixed so deep-links are processed by the already-open tab.

### Added

- Add tests for single-instance, and auth service.
- **Wallet Scanner**: Support for OID4VCI indirect flow. The wallet can now process HTTPS QR codes by extracting the `credential_offer_uri` parameter, ensuring interoperability with native device cameras and browser-based redirections.

### Fixed (OID4VCI redirect_uri multi-tenant)

- **`env.template.js`** / **`.github/workflows/deploy.yml`** — eliminada la variable build-time `OID4VCI_REDIRECT_URI` (GitHub Variable borrada también). El mismo bundle se publica a todos los tenants (`sandbox-stg`, `kpmg-stg`, `dome-stg`, …) y el `redirect_uri` se deriva en runtime de `window.location.origin` vía el fallback ya existente en `environment.production.ts`. Causa del 504 reportado: el host fijado (`wallet-stg.altia.eudistack.net`) no resolvía en DNS tras EUDI-094.
- **`environment.production.ts`** — documentada la derivación dinámica por origin.
- **`src/assets/env.js`** — fallback local alineado con el nuevo contrato (string vacío).
- Follow-up: [EUDISTACK-170](https://eudistack.atlassian.net/browse/EUDISTACK-170) — validar `redirect_uri` contra allowlist por tenant en el Issuer (hoy acepta cualquier valor enviado en el PAR).

### Fixed (Multi-tab single-instance)

- **Multi-tab (Single Instance):** Fixed a critical issue that caused an infinite login redirection loop in the main tab when the user opened a second Wallet tab. Now, the secondary tab correctly detects the leader and cleanly halts its execution (`dispose()`) without corrupting session tokens or emitting erroneous navigation events.

### Pending (EUDI-094 multi-tenant rollout)

- E2E OID4VCI flow against same-origin Issuer (`/issuer/*`) still to be
  validated on STG with real tenant (scheduled 2026-04-24). No code
  change anticipated; expected to be green post verifier redeploy.

## [3.3.0] - 2026-04-23

### Changed (EUDI-094 — runtime per-tenant theme from shared bucket)

- **`theme.service.ts`** — `load()` resuelve el tenant desde `window.location.hostname` con `resolveTenant()` y pide `/assets/tenants/<tenant>/theme.json` (URL absoluta, bucket compartido servido por CloudFront). Los paths legacy `assets/tenant/*` dentro del theme se reescriben a `/assets/tenants/<tenant>/*`. Helper `isRelativeAssetPath` renombrado a `isSafeAssetPath`; nuevo helper `toAbsoluteAssetUrl` para el manifest PWA.
- **`index.html`** y **`tenant-not-found.page.html`** — favicon default pasa a ser el producto (`assets/icons/pwa-192x192.png`) en lugar de referenciar `assets/tenant/*`. El ThemeService inyecta dinámicamente el favicon del tenant tras resolverlo.
- **`ngsw-config.json`** — `/assets/tenants/**` excluido del asset prefetch; el theme del tenant se cachea en dataGroup con freshness (1h).
- **`.github/workflows/deploy.yml`** — eliminada la inyección build-time de tenant assets y el input `tenant`. El build ahora es único y se publica a `s3://.../wallet/`; se invalidan todas las CloudFront STG del entorno.
- **`.github/workflows/release.yml`** — el release dispara `deploy.yml` automáticamente tras el tag sin parametrizar tenant (un solo deploy sirve a todos los tenants).

## [3.2.0] - 2026-04-23

### Changed (EUDI-094 — theme loaded from single deploy-time asset)

- **`theme.service.ts`** — `load()` ahora carga un único `assets/theme.json` y elimina el fallback runtime (`isKnownTenant` + `resolveTenant`). La personalización per-tenant se resuelve en CI: `.github/workflows/deploy.yml` copia `eudistack-platform-assets/tenants/<TENANT>/theme.json` a `assets/theme.json` y `tenants/<TENANT>/*` a `assets/tenant/` antes del upload a S3. `rewriteAssetPaths()` se simplifica a normalizar rutas absolutas `/assets/...` a relativas (sin tenant interpolation).
- **`index.html`** y **`tenant-not-found.page.html`** — favicon default migrado de `favicon.png` a `favicon.svg`, alineado con la estructura de `eudistack-platform-assets` (todos los tenants exponen `favicon.svg`).

## [3.1.2] - 2026-04-23

### Fixed (EUDI-064 post-release — env suffix in tenant resolution)

- **`tenants.constants.ts`** — `resolveTenant()` ahora elimina los sufijos de entorno `-stg`, `-dev`, `-pre` antes del lookup en `KNOWN_TENANTS`. Motivación: en STG el host es `sandbox-stg.eudistack.net` y el guard `isKnownTenant` devolvía `false`, redirigiendo al usuario a `/tenant-not-found`. Replica la lógica que ya hace `TenantDomainWebFilter` en el backend (core-issuer) y alinea con el mismo fix en el MFE Credential Manager.
- **`buildFallbackUrl()`** — preserva el sufijo de entorno del host actual al reconstruir la URL de fallback. Evita que un usuario en STG salte a PROD.
- **`theme.service.ts`** — sustituido `hostname.split('.')[0]` ad-hoc por `resolveTenant()`.
- **`tenant-not-found.page`** — añadido logo en la pantalla (antes sólo había texto).

## [3.1.1] - 2026-04-21

### Changed

- Credential schemas (`src/assets/schemas/*.json`) are now synced from `eudistack-platform-dev/dev-tools/schemas/` on every `prestart`/`prebuild` via `scripts/sync-schemas.js` (extracted from inline `package.json` one-liner). Platform-dev is the single source of truth; the directory is git-ignored.
- CI and Deploy workflows sparse-checkout `eudistack-platform-dev` as a sibling so the sync step has a real source on every build.

### Added

- Login and register with Wallet EBS in server mode

### Fixed

- `httpTranslateLoader` spec expected absolute `/assets/i18n/en.json` but the loader was changed to relative (`assets/i18n/`) in 11366b3 for `base-href=/wallet/` compatibility. Updated the spec assertion to match.
- `sync-schemas` script exits with error when canonical schemas are missing instead of falling back silently to stale bundled copies.
- Improved rear camera detection for iOS and now the rear camera is selected by default.

### Removed

- 8 legacy schemas absent from canonical source: `eu.europa.ec.eudi.{employee,pid,por}.1.{json,profile.json}` and orphan `learcredential.{employee,machine}.w3c.1.profile.json`.

## [3.0.2] - 2026-04-20

### Changed

- Standardize query parameter detection to `credential_offer_uri` to align with OIDC4VCI standards.
- Integrate `CredentialOfferService` to correctly parse and decode nested/double-encoded offer URIs.

## [3.0.1] - 2026-04-17

## [3.1.0] - 2026-04-20

### Added (Interaction tokens)

- Brand-independent CSS tokens `--ui-caret`, `--ui-focus-ring`, `--ui-focus-ring-rgb`, `--ui-selection-bg`, `--ui-selection-fg` in `variables.scss`. Guarantee WCAG AA contrast regardless of tenant branding.
- Global `::selection` rule in `globalDefault.scss` using the new interaction tokens.

### Fixed (Interaction tokens)

- Replace broken `caret-color: var(---primary-color)` (triple-dash typo) with `var(--ui-caret)` in `OtpInputComponent` and the register page.

### Added (EUDI-064: Tenant validation)

- **`tenantGuard`** — Angular route guard that validates tenant exists before rendering protected routes.
- **`TenantNotFoundPage`** — user-friendly error page for unknown tenant subdomains.
- **`tenants.constants`** — central registry of valid tenants.
- `error-handler.interceptor`: redirect to tenant-not-found on tenant 404.
- `theme.service`: handle tenant-not-found theme state.
- i18n keys for tenant-not-found page (ca/en/es).

### Added

- **RFC 9901 compliant SD-JWT parser** — Rewrite `SdJwtParserService` with digest-based disclosure resolution at any nesting depth. Synchronous pure-JS SHA-256. (EUDI-012)
- **Mandate wrapper SD-JWT schemas** — Updated `learcredential.employee.sd.1.json` and `learcredential.machine.sd.1.json` with nested mandate structure. (EUDI-012)
- **Single-instance PWA** — `SingleInstanceService` (BroadcastChannel leader election) + `launch_handler: navigate-existing` in manifest. Subsequent tab opens are absorbed by the existing tab; the user is always re-authenticated before any protocol flow.
- **SW auto-update** — `SwUpdateService` activates new Service Worker versions immediately on `VERSION_READY` to prevent zombie workers.
- **Nginx no-cache headers** — `index.html`, `manifest.webmanifest`, `ngsw.json` and `ngsw-worker.js` served with `Cache-Control: no-store` to prevent stale asset serving after deployments.

### Fixed

- **Credential card showing mandator instead of mandatee** — Aligned W3C credential type versions from `.w3c.4`/`.w3c.3` to `.w3c.1` matching the schema `credential_configuration_id`. Fixes schema registry lookup failure that caused `summary_claims` to be ignored.
- **PWA install race condition (EUDI-402)** — Deterministic `installDecision$` observable prevents the install screen from being skipped on first load in STG.
- **"Close tab" button non-functional** — Duplicate-tab UI close button now works; falls back to keyboard shortcut hint if the browser blocks `window.close()`.

### Changed

- **EUDI-013:** Rename credential type IDs: `learcredential.employee.w3c.1` → `.w3c.4`, `learcredential.machine.w3c.1` → `.w3c.3`
- **EUDI-013:** Update asset schema files to match new credential type IDs
- Update style files to apply tenant text color in platform-assets.
- Back the primary color for verify button (it changed the contrast color in the commit 46bfd21).
- Remove --action-primary CSS variable and its hue/lightness computation function, using --primary-color instead.
- Remove color variables from theme.service.ts that duplicated values already defined in variables.scss.
- Add brand-independent neutral color variables to variables.scss.

### Removed

- Removed several unused dependencies from the repository (cleaned up `package.json` and removed unused libraries):
  - `@simplewebauthn/browser`
  - `@zxing/browser`
  - `wallet-ui`
  - `@babel/plugin-proposal-decorators`
  - `jasmine-spec-reporter`
  - `ng-mocks`

### Fixed

- Clean up mixed/incorrect translations across EN/ES/CA.
- Fixed popup after vc delete.
- Fix credential detail modal and verification modal closing incorrectly when the browser back button is pressed.
- Dark theme.
- Translate revoke state URL from vc detail modal to verification detail modal.
- Fix minor spelling issues in es/ca/en.
- Remove unnecessary white bar from the `vc-selector`.
- Fix asymmetric spacing on credential card in the vc-view for mobile display.
- Don't open VC details when selecting one to login.
- Show error alert and navigate to credentials page when no valid credentials are available in vc-selector.
- Fix textarea highlight overflow and align padding with manual send button.
- Remove the revoke URL text and button from the verification modal.
- Use translation labels for verification text.
- Enable touch scroll in settings page.
- Fixed keyboard input and navigation logic to prevent character duplication and improved state synchronization for pasting.
- Fixed an issue causing double login prompts when submitting invalid credentials to the verifier by preventing unintended logout on error.
- Show error alert when scanning unsupported or invalid QR content, preventing processing of unrelated data.
- Improve language selector reliability: selecting a language now works consistently when clicking anywhere on the row, not only on the radio circle.

## [3.0.0] - 2026-03-24

### Added

- Add `tenantDomain` field to Theme interface and expose it as a public getter in ThemeService.
- Add per-context color tokens in ThemeService (header, card, button, auth overrides) for tenant-specific theming.
- Add DoctorID credential type support (`doctorid.sd.1`) with type registry, schema registry, normalizer, and type map.
- Add credential status propagation via `statusChanged` event in VcViewComponent.
- Add Dependabot configuration for npm security updates and GitHub Actions.
- Add PR template with EUDI closing tasks checklist.
- Align CI/CD workflows: build automatic (with Jest coverage), deploy and release manual.

### Changed

- Move branding configuration (colors, logo, favicon, default language) from env.js to theme.json for multi-tenant runtime theming.
- Remove branding variables from env.template.js, env.js, and global.d.ts Window type.
- Replace hardcoded `action-primary` and `rgba(37,99,235,...)` colors with CSS custom properties across auth, home, tabs, vc-selector, and vc-view SCSS files.
- Move privacy blur from entire card body to card fields only (card title remains visible).
- Improve revoked/expired credential card styling with per-element opacity instead of whole-card dimming.
- Fix SVG asset path to source from ionicons node_modules.
- Set default favicon path in index.html (`assets/tenant/favicon.png`).

### Fixed

### Security

- Add hex color validation in ThemeService to prevent CSS injection via theme.json.
- Add relative path validation for favicon and PWA icon URLs to prevent external URL hijacking.
- Type `updateCredentialStatus` chain with `LifeCycleStatus` instead of `string`, removing `as any` casts.
- Remove direct signal input mutation in VcViewComponent; parent now owns state changes.

## [2.1.1](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.1.1)

### Changed

- The OID4VCI and OID4VP flows use the Web Crypto API and the Indexed DB for the signature.

## [2.1.0](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.1.0)

### Added

- Enable optional OID4VCI flow which generates signature Web Crypto API and stores it in the browser (dev-mode).

## [2.0.10](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.0.10)

### Changed

- Make the selected tab bar button color depend on the secondary custom color.

## [2.0.9](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.0.9)

### Changed

- Make primary and secondary ionic color variables fully configurable.

## [2.0.8](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.0.8)

### Changed

- Configure logo and favicon using the `ASSETS_BASE_URL` environment variable combined with asset-specific paths.

## [2.0.7](https://github.com/in2workspace/in2-issuer-ui/releases/tag/v2.0.7)

### Added

- Altia and ISBE favicons.

### Changed

- Rename DOME favicon.

## [v2.0.6](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.6)

### Fixed

- Add missing translations.

## [v2.0.5](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.5)

### Fixed

- Add missing translations.

## [v2.0.4](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.4)

### Fixed

- Fix "product offering" power action translation.

## [v2.0.3](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.3)

### Fixed

- Add missing translations.

## [v2.0.2](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.2)

### Changed

- Get PIN code description from i18n files, not from API websocket message.

## [v2.0.1](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.1)

### Added

- Get default language from environment.

### Fixed

- Add missing translations.

## [v2.0.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v2.0.0)

### Changed

- Changed VC card view.
- Request signature by credential procedure id.
- Issuer field can be string or object.

### Added

- Credential Status
- Show LEARCredentialMachine mandatee details.

### Fixed

- Don't show "Credentials not found" message while loading credentials.
- Don't show error popup when credential signature request fails.
- Fix error message when trying to login without credentials.

### Removed

- Scan button in credentials page.

## [v1.9.9](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.9)

### Added

- Added loading spinner for async operations.

### Changed

- Don't close PIN popup on backdrop click.
- Disable device selector while selected device is being switched.

### Fixed

- Don't show credentials tab after clicking on scan button.
- Avoid error when switching devices.
- Show credentials list when scanner is open and credentials tab button is clicked.

## [v1.9.8](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.8)

### Fixed

- Don't redirect to home when navigating right after login.

## [v1.9.7](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.7)

### Fixed

- Fix error handling for auth errors

## [v1.9.6](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.6)

### Fixed

- Fix delete credential endpoint.

## [v1.9.5](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.5)

### Fixed

- In the credentials selector page, show the updated credentials list

### Changed

- Enhance credentials selector page: show a text indicating to select a credential and show the list in the same order than in credentials page

## [v1.9.4](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.4)

### Changed

- Changed env variable name: "WALLET_API_EXTERNAL_URL" > "WALLET_API_INTERNAL_URL"

## [v1.9.3](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.3)

### Fixed

- Changed support URL from "-prd.org" to ".eu"

## [v1.9.2](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.2)

### Fixed

- Don't show popup for "No internet connection" error

## [v1.9.1](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.1)

### Modified

- Modify API env variables names

### Fixed

- Don't enable logs if LOGS_ENABLED env var is false

## [v1.9.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.9.0)

### Modified

- Modify configurable variables names, make some of them constants
- Remove unused images and ebsi references

## [v1.8.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.8.0)

### Changed

- Unsigned credentials are now automaticly updated if issuer has signed them
- Added info button when credential is unsigned
- Minor visual adjustments

### Fixed

- Minor Fixes

## [v1.7.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.7.0)

### Added

- Compatibility for LEARCredentialEmployee V2

## [v1.6.3](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.6.3)

### Fixed

- Load translations on initialization

## [v1.6.2](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.6.2)

### Fixed

- Camera selector
- Deactivate camera when switching fast between tabs

## [v1.6.1](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.6.1)

### Added

- Added customized colors for navbar and logo.

## [v1.5.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.5.0)

### Added

- New route to execute same-device credential issuance workflow.
- Timeout counter added to "Enter PIN" popup
- More informative messages in case of error in the process of sending PIN to get credential

## [v1.4.0](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.4.0)

### Changed

- Refactor architecture to standalone.
- Changed callback page design.

### Fixed

- Fixed the persistent callback page when state is invalid or other reasons.
- Fixed routing issues.
- Fixed some styles.

## [v1.3.7](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.3.7)

### Fixed

- Added clean refresh to logout.

## [v1.3.6](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.3.6)

### Fixed

- Add expired view for credentials when the credential is expired.

## [v1.3.5](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.3.5)

### Fixed

- Successful login and Error messages style.

### Updated

- Credential added message slyle.

## [v1.3.4](https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.3.4)

### Fixed

- Refresh credentials list after deleting credential.

### Updated

- No credentials and Settings views slyle.

## [v1.3.3]

### Fixed

- The Error popup is shown when the user has no credentials.

## [v1.3.2] - ()

### Fixed

- The Error popup is shown when the user has no credentials.
- Expiration messages of credentials view are hidden

## [v1.3.1] - ()

### Fixed

- Error popup isn't shown when an already used login QR is used.

## [v1.3.0] - ()

### Added

- Pop up error message on unsuccessful login.

### Updated

- Update an Angular and scanner version.

### Fixed

- Translations
- Multiple Vcs send.
- Camera remains activated when leaving scanner page.

## [v1.2.0] - (https://github.com/in2workspace/in2-wallet-ui/releases/tag/v1.2.0)

### Added

- New endpoint for credential retrieval.
- User alerts for credential status.
- Pop-up dialogs for user interactions.
- Improved accessibility for QR components.

### Fixed

- Error handling for 202 and 204 status codes.
- Default camera selection issues.
- Text corrections for better translations.

### Updated

- Refined page refresh and redirection logic.
- Enhanced button behavior and UI components.

## [1.1.0] - (https://github.com/in2workspace/wallet-ui/releases/tag/v1.1.0)

### Added

- New oidc login connection config.
- Support for GitHub Actions for CI/CD.
- Added SonarCloud for code quality.
- Improved OIDC compatibility.
- Websocket connection.
- Ebsi implementation.
- CBOR presentation Credential support.

### Fixed

- UI/UX issues.
- SonarCloud issues.
- Error handling issues.
- Translation issues.
- SonarCloud issues.

### Updated

- Verifiable Credential Interface.

### Deleted

- Registration
- User DID management

## [1.0.0](https://github.com/in2workspace/wallet-ui/releases/tag/v1.0.0) - 2023-11-21

### Added

- User registration
- User login
- User logout
- User QR Scanning
- User DID management
- User Verifiable Credentials management
- User Preferred Language management
- User preferred Scanning Camera management
