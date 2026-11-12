import dayjs from 'dayjs';
import { VerifiableCredential } from '../models/verifiable-credential';

/** The statuses a user can filter by; an unsigned (`ISSUED`) attestation has none. */
export type FilterableStatus = 'VALID' | 'REVOKED' | 'EXPIRED';

export const FILTERABLE_STATUSES: readonly FilterableStatus[] = ['VALID', 'REVOKED', 'EXPIRED'];

/** An empty string means "any". */
export interface CredentialFilters {
  type: string;
  issuer: string;
  status: '' | FilterableStatus;
}

export const NO_FILTERS: CredentialFilters = { type: '', issuer: '', status: '' };

export function credentialTypeLabel(cred: VerifiableCredential): string {
  return cred.name?.trim() || cred.type?.[cred.type.length - 1] || '';
}

export function credentialIssuerLabel(cred: VerifiableCredential): string {
  return cred.issuer?.organization || cred.issuer?.id || '';
}

/** The status the user sees: a past expiry date makes it expired whatever the stored status says. */
export function credentialStatusOf(cred: VerifiableCredential): FilterableStatus | null {
  if (cred.lifeCycleStatus === 'REVOKED') return 'REVOKED';
  if (cred.lifeCycleStatus === 'EXPIRED') return 'EXPIRED';
  if (cred.lifeCycleStatus !== 'VALID') return null;
  const expiry = cred.validUntil ? dayjs(cred.validUntil) : null;
  return expiry?.isValid() && expiry.isBefore(dayjs()) ? 'EXPIRED' : 'VALID';
}

export function hasActiveFilters(filters: CredentialFilters): boolean {
  return filters.type !== '' || filters.issuer !== '' || filters.status !== '';
}

/** The filters combine: an attestation must meet all of those in use. */
export function filterCredentials(
  credentials: VerifiableCredential[],
  filters: CredentialFilters,
  typeLabel: (cred: VerifiableCredential) => string = credentialTypeLabel,
): VerifiableCredential[] {
  return credentials.filter(cred =>
    (filters.type === '' || typeLabel(cred) === filters.type)
    && (filters.issuer === '' || credentialIssuerLabel(cred) === filters.issuer)
    && (filters.status === '' || credentialStatusOf(cred) === filters.status)
  );
}

export function distinctTypes(
  credentials: VerifiableCredential[],
  typeLabel: (cred: VerifiableCredential) => string = credentialTypeLabel,
): string[] {
  return distinctSorted(credentials.map(typeLabel));
}

export function distinctIssuers(credentials: VerifiableCredential[]): string[] {
  return distinctSorted(credentials.map(credentialIssuerLabel));
}

function distinctSorted(values: string[]): string[] {
  return [...new Set(values.filter(value => value !== ''))].sort((a, b) => a.localeCompare(b));
}
