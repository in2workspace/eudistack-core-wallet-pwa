/**
 * Best-effort browser name from a stored `navigator.userAgent` string (e.g. the one sent
 * at passkey registration time, see `login.page.ts`'s `registerPasskey` call). Order
 * matters: Edge/Opera/Chrome-on-iOS UAs all contain "Chrome" and/or "Safari" tokens too,
 * so the more specific browser must be checked first.
 */
export function getBrowserName(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  // Desktop Edge is "Edg/", but mobile Edge swaps its own token for "EdgA/"
  // (Android) or "EdgiOS/" (iOS) instead — matched here too, or both fall
  // through to the Chrome/CriOS checks below and get misreported as Chrome.
  if (/Edg(?:A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/OPR\//.test(userAgent) || /Opera/.test(userAgent)) return 'Opera';
  if (/FxiOS\//.test(userAgent) || /Firefox\//.test(userAgent)) return 'Firefox';
  if (/CriOS\//.test(userAgent) || /Chrome\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return null;
}
