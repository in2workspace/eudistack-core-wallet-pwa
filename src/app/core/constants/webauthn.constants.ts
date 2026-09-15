/**
 * WebAuthn UI hints (Level 3) sent on every `navigator.credentials.create()` /
 * `.get()` call in the app, so the browser's authenticator picker offers the
 * same set of options everywhere: this device, a phone/tablet over hybrid
 * (QR), and a roaming security key.
 *
 * Without an explicit `hints`, Chrome and Edge on Windows diverge on what
 * they show first for a request with no `authenticatorAttachment` — Edge
 * favours the Windows Hello platform prompt and never surfaces the
 * cross-device (QR) option, while Chrome's account chooser lists everything.
 * Declaring the same hints on every call standardizes the request instead of
 * relying on each browser's undocumented default heuristic.
 *
 * Not yet in this project's TS lib types outside the *OptionsJSON variants
 * (WebAuthn L3, lib.dom.d.ts lag) — call sites need a `@ts-expect-error` to
 * attach it to `PublicKeyCredentialCreationOptions` / `RequestOptions`.
 */
export const WEBAUTHN_HINTS: readonly string[] = ['hybrid', 'security-key', 'client-device'];
