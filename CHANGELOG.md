# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.8.4] - 2026-06-17

### Changed (2026-06-17)
- **Wallet API URL resolution** is resolved with the appropiate canonical or non-canonical URL.

## [3.8.3] - 2026-06-15

### Added (2026-06-15)
- Added `cgcom` to the list of known tenants.
- **Custom-domain tenant resolution (`TenantService`)**: the app now resolves the active tenant via a two-step lookup — first from the hostname subdomain (existing behaviour), then from `/assets/tenants/custom-domain.json` (a `{ "hostname": "tenantId" }` map) when the subdomain does not match a known tenant. The resolved tenant (or `null` for unknown origins) is stored in a `Signal<string | null>` initialised before theme loading and consumed by `ThemeService`, `tenantGuard` and `TenantNotFoundPage`.

### Changed (2026-06-15)
- **`tenants.constants.ts`**: reduced to data-only (`KNOWN_TENANTS`, `FALLBACK_TENANT`); resolution functions moved to `TenantService` as private methods.
- **`tenantGuard`**, **`tenatnNotFound`**, **`credentialOfferService`**: read the resolved tenant signal from `TenantService` instead of re-deriving it from the hostname on every navigation.
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
  - `settings.page.{ts,html}` — nuevo `walletModeKey` y `<ion-badge>` justo encima del item *About*.
  - `i18n/{en,es,ca}.json` — claves `settings.wallet-mode-label`, `wallet-mode-eudiw`, `wallet-mode-business`.
- **Settings → Knowledge base link** — item visible cuando el `theme.json` del tenant define `content.knowledgeBaseUrl`. Todos los tenants EUDIStack ahora apuntan a `https://docs.eudistack.net` (excepto DOME, que mantiene su KB propia).

### Fixed

- **`appVersion` hardcoded a 3.0.0** — `environment{,.production}.ts` y `package.json` desincronizados desde hace varias releases; *About* siempre mostraba `v3.0.0` independientemente del bundle desplegado. Bumpeado a `3.4.0` en los tres ficheros (follow-up: derivar `appVersion` de `package.json` en build-time para no volver a olvidarlo).
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
- Add brand-independent neutral color variables	to variables.scss.

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
