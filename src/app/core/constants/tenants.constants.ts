export const KNOWN_TENANTS: readonly string[] = [
  'dome',
  'kpmg',
  'sandbox',
  'platform',
  'eudistack',
  'localhost',
];

export const FALLBACK_TENANT = 'sandbox';
const WALLET_HOME_PATH = '/wallet/';

export function resolveTenant(hostname: string): string {
  return hostname.split('.')[0].toLowerCase();
}

export function isKnownTenant(hostname: string): boolean {
  return KNOWN_TENANTS.includes(resolveTenant(hostname));
}

/**
 * Builds the fallback URL for the sandbox tenant based on the current location.
 * Replaces the first hostname segment (the tenant) with "sandbox" and keeps
 * protocol + port + wallet base path intact.
 *
 * Examples:
 * - https://patata.eudistack.net     → https://sandbox.eudistack.net/wallet
 * - https://patata.127.0.0.1.nip.io:4443 → https://sandbox.127.0.0.1.nip.io:4443/wallet
 */
export function buildFallbackUrl(location: Location = window.location): string {
  const segments = location.hostname.split('.');
  const hasSubdomain = segments.length > 1;
  const targetHost = hasSubdomain
    ? [FALLBACK_TENANT, ...segments.slice(1)].join('.')
    : location.hostname;

  const port = location.port ? `:${location.port}` : '';
  return `${location.protocol}//${targetHost}${port}${WALLET_HOME_PATH}`;
}
