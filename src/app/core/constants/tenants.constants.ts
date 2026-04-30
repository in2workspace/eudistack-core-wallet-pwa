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

const ENV_SUFFIXES = ['-stg', '-dev', '-pre'] as const;

function stripEnvSuffix(tenant: string): { base: string; suffix: string } {
  const match = ENV_SUFFIXES.find((s) => tenant.endsWith(s));
  return match
    ? { base: tenant.slice(0, -match.length), suffix: match }
    : { base: tenant, suffix: '' };
}

export function resolveTenant(hostname: string): string {
  const first = hostname.split('.')[0].toLowerCase();
  return stripEnvSuffix(first).base;
}

export function isKnownTenant(hostname: string): boolean {
  return KNOWN_TENANTS.includes(resolveTenant(hostname));
}

/**
 * Builds the fallback URL for the sandbox tenant based on the current location.
 * Replaces the first hostname segment (the tenant) with "sandbox" and preserves
 * the environment suffix (-stg/-dev/-pre) so STG users don't jump into PROD.
 */
export function buildFallbackUrl(location: Location = window.location): string {
  const segments = location.hostname.split('.');
  const hasSubdomain = segments.length > 1;

  let targetHost: string;
  if (hasSubdomain) {
    const { suffix } = stripEnvSuffix(segments[0].toLowerCase());
    targetHost = [`${FALLBACK_TENANT}${suffix}`, ...segments.slice(1)].join('.');
  } else {
    targetHost = location.hostname;
  }

  const port = location.port ? `:${location.port}` : '';
  return `${location.protocol}//${targetHost}${port}${WALLET_HOME_PATH}`;
}
