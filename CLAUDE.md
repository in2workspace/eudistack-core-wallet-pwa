# Wallet PWA (EUDIW / EBW frontend) — Repo Guide for Claude

> **Per-repo CLAUDE.md.** Loaded only when working inside this repo. The
> SDD Constitution lives in `../eudistack-platform-dev/CLAUDE.md`.

## Identity

Angular 19 + Ionic Progressive Web App. Single codebase that serves
two product surfaces:

- **EUDI Wallet (citizen)** — personal verifiable credentials
- **European Business Wallet (EBW, organizations)** — frontend to `eudistack-core-wallet-ebw` backend

Cryptography: WebAuthn + Passkey + PRF (NOT raw WebCrypto — that's
legacy and migrated). Local storage: IndexedDB.

## Tech stack

- **Angular 19** standalone components
- **Ionic 7+** UI primitives
- **TypeScript** strict mode
- **SCSS** scoped per component
- **@ngx-translate** for i18n
- **angular-auth-oidc-client** for OIDC
- **Capacitor** (configured but PWA-first)
- **Jest** + Testing Library for tests
- **ESLint** + Angular ESLint

## Architecture

Standalone components throughout. Signals for local state. Reactive
Forms for any form. Strict path-scoped conventions in
`../eudistack-platform-dev/.claude/rules/frontend-conventions.md`.

## Multi-tenancy

- **Same-origin per tenant.** Wallet PWA of tenant X only talks to Issuer/EBW of tenant X. Cross-tenant calls = CORS + session loss.
- See SAD §3.1 + ADR-001.
- `KNOWN_TENANTS` list is duplicated here and in MFE Credential Manager — keep in sync (tech debt EUDI-048).

## Common commands

> **Do NOT `ng serve`.** The stack expects nginx multi-tenant routing via `make up` from `eudistack-platform-dev`.

| Task | Command |
|------|---------|
| Install | `npm ci` |
| Production build | `npm run build` |
| Dev build | `npm run build:dev` |
| Unit tests | `npm test` |
| Tests with coverage | `npm test -- --coverage` |
| Lint | `npx eslint .` |
| Rebuild in stack | `cd ../eudistack-platform-dev && make rebuild-wallet-pwa` |

## Testing conventions

- `*.spec.ts` mirrors the production file.
- `@testing-library/angular` + `provideHttpClientTesting()`.
- One assertion concept per test.
- Use `TestBed.runInInjectionContext()` when calling `inject()` outside an injection context.
- Aim ≥80% line coverage on new code.

## Code style

- **Standalone components only.** No `NgModule` declarations.
- **`inject()`** over constructor injection.
- **Control-flow** syntax: `@if` / `@for` / `@switch` (not `*ngIf`/`*ngFor`).
- **Signals** for local state; RxJS only for HTTP/external streams.
- **No `any`.** Use `unknown` + narrowing.
- **No `console.log`** in production code — use the logger service.
- **No hardcoded API URLs.** Use `environment.ts` + `UrlResolver`.
- All user-facing strings via `@ngx-translate`.

## Where to find specs

Functional + technical specs:
`../eudistack-platform-dev/docs/EUDISTACK-NNN-*/EUDISTACK-MMM/`.
Visual specs (Figma): page **07 Wallet (EUDI + Business)** in the
EUDIStack main Figma file.

## Git workflow

- **Squash merge to `main`.** Conventional Commits + Story footer.
- Branch-guard hook blocks direct commits to `main`.

## References

- Constitution: [`../eudistack-platform-dev/CLAUDE.md`](../eudistack-platform-dev/CLAUDE.md)
- SAD: [`../eudistack-platform-dev/docs/_shared/architecture/sad.md`](../eudistack-platform-dev/docs/_shared/architecture/sad.md)
- Skills: `angular-conventions`, `figma-ux-review`, `code-review-checklist`, `commit-conventions`
- Rules: `frontend-conventions`, `protocol-compliance`
