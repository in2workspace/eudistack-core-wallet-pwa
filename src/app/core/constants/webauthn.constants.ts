/**
 * WebAuthn UI hints (Level 3) sent on `navigator.credentials.create()` /
 * `.get()` calls in the app, so the browser's authenticator picker
 * standardizes on a known order instead of relying on each browser's
 * undocumented default heuristic.
 *
 * Without an explicit `hints`, Chrome and Edge on Windows diverge on what
 * they show first for a request with no `authenticatorAttachment` — Edge
 * favours the Windows Hello platform prompt and never surfaces the
 * cross-device (QR) option, while Chrome's account chooser lists everything.
 *
 * `hints` is a *descending preference order* (WebAuthn L3), not a filter —
 * the browser still lists every option, just not first. That means the same
 * array is not always the right choice:
 *
 * - `WEBAUTHN_CREATE_HINTS` — registration (`create()`, no
 *   `authenticatorAttachment`). Prefers hybrid/QR first so Edge doesn't jump
 *   straight to the Windows Hello prompt.
 * - `WEBAUTHN_ASSERTION_HINTS` — assertion of an already-known local
 *   credential (`get()` with `allowCredentials`): login, PRF detection, PRF
 *   wrap key derivation. That credential normally lives on this device, so
 *   hybrid-first would invite Chrome to offer a phone/QR picker for a
 *   platform credential that isn't there; prefer `client-device` instead.
 *
 * Not yet in this project's TS lib types outside the *OptionsJSON variants
 * (WebAuthn L3, lib.dom.d.ts lag) — call sites need a `@ts-expect-error` to
 * attach it to `PublicKeyCredentialCreationOptions` / `RequestOptions`.
 */
export const WEBAUTHN_CREATE_HINTS: readonly string[] = ['hybrid', 'security-key', 'client-device'];
export const WEBAUTHN_ASSERTION_HINTS: readonly string[] = ['client-device'];
