import { ActivityEntry } from 'src/app/core/models/activity.model';

const MAX_COUNTERPARTY_LENGTH = 30;

export interface CounterpartySource {
  clientName?: string;
  redirectUri?: string;
  clientId?: string;
}

/**
 * Formats the counterparty of an activity entry for display:
 * URLs are reduced to their hostname, did: URIs are truncated,
 * anything else (or empty input) is passed through as-is.
 */
export function formatCounterparty(entry: ActivityEntry): string {
  return formatRawCounterparty(entry.counterparty);
}

/**
 * Resolves a human-friendly verifier name to store in the activity log:
 * the verifier's client_name, else the hostname of its response URI, else
 * its client_id formatted for display. Always capped in length because the
 * name is controlled by the verifier.
 */
export function resolveCounterpartyName(source: CounterpartySource): string {
  const name = source.clientName?.trim();
  if (name) {
    return capLength(name);
  }
  const host = hostnameOf(source.redirectUri);
  if (host) {
    return capLength(host.replace(/^www\./i, ''));
  }
  return capLength(formatRawCounterparty(source.clientId));
}

function formatRawCounterparty(value: string | undefined): string {
  const raw = value?.trim() ?? '';
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

function hostnameOf(value: string | undefined): string {
  try {
    return new URL(value ?? '').hostname;
  } catch {
    return '';
  }
}

function capLength(value: string): string {
  return value.length > MAX_COUNTERPARTY_LENGTH ? `${value.slice(0, MAX_COUNTERPARTY_LENGTH - 1)}…` : value;
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
