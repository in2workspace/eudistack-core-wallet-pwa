/**
 * RFC 7807 Problem Details as returned by the EUDIStack backends (Issuer, EBW, Verifier).
 * Only `type` is guaranteed once parsed: it is the stable, machine-readable
 * discriminator. `title`/`detail` are human-readable English text meant for
 * logs and must never drive UI decisions or be shown to the user.
 */
export interface ApiError {
  type: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
}

/** Problem `type` values the wallet reacts to specifically. */
export const API_ERROR_TYPE = {
  CREDENTIAL_OFFER_EXPIRED: 'credential_offer_expired',
  CREDENTIAL_OFFER_NOT_FOUND: 'credential_offer_not_found',
  CREDENTIAL_ALREADY_ISSUED: 'credential_already_issued',
  CREDENTIAL_REVOKED: 'credential_revoked',
} as const;

/**
 * Best-effort extraction of a Problem Details body. Accepts both the parsed
 * object (`responseType: 'json'`) and the raw string Angular leaves in
 * `HttpErrorResponse.error` for `responseType: 'text'` requests. Returns
 * `null` for empty, non-JSON or partially formed bodies (no string `type`),
 * so callers fall back to status-based handling instead of crashing.
 */
export function parseApiError(body: unknown): ApiError | null {
  const candidate = typeof body === 'string' ? tryParseJson(body) : body;
  if (!candidate || typeof candidate !== 'object') return null;

  const raw = candidate as Record<string, unknown>;
  if (typeof raw['type'] !== 'string' || raw['type'].trim() === '') return null;

  return {
    type: raw['type'],
    title: asString(raw['title']),
    status: typeof raw['status'] === 'number' ? raw['status'] : undefined,
    detail: asString(raw['detail']),
    instance: asString(raw['instance']),
  };
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}