import { ActivityEntry } from 'src/app/core/models/activity.model';

/**
 * Formats the counterparty of an activity entry for display:
 * URLs are reduced to their hostname, did: URIs are truncated,
 * anything else (or empty input) is passed through as-is.
 */
export function formatCounterparty(entry: ActivityEntry): string {
  const raw = entry.counterparty?.trim() ?? '';
  if (!raw) {
    return '';
  }
  try {
    const url = new URL(raw);
    if (url.hostname) {
      return url.hostname;
    }
    if (url.protocol === 'did:') {
      return truncateDid(raw);
    }
    return raw;
  } catch {
    return raw;
  }
}

/**
 * Formats a timestamp as an absolute, locale-aware date and time
 * (e.g. for a tooltip next to a relative time label).
 */
export function formatAbsoluteTime(timestamp: number, locale = 'es-ES'): string {
  return new Date(timestamp).toLocaleString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncateDid(did: string): string {
  const match = did.match(/^(did:[a-z0-9]+:)(.+)$/i);
  if (!match) {
    return did;
  }
  const [, prefix, identifier] = match;
  if (identifier.length <= 14) {
    return did;
  }
  return `${prefix}${identifier.slice(0, 4)}…${identifier.slice(-6)}`;
}
