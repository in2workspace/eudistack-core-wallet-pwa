import { VerifiableCredential } from '../models/verifiable-credential';
import {
  credentialStatusOf, distinctIssuers, distinctTypes, filterCredentials, hasActiveFilters, NO_FILTERS
} from './credential-filter.util';

function credential(overrides: Partial<VerifiableCredential>): VerifiableCredential {
  return { id: 'x', lifeCycleStatus: 'VALID', issuer: { id: 'did:issuer' }, ...overrides } as VerifiableCredential;
}

const employeeAcme = credential({ id: '1', name: 'Employee', issuer: { id: 'i1', organization: 'Acme' } as never });
const employeeGlobex = credential({ id: '2', name: 'Employee', issuer: { id: 'i2', organization: 'Globex' } as never, lifeCycleStatus: 'REVOKED' });
const machineAcme = credential({ id: '3', name: 'Machine', issuer: { id: 'i1', organization: 'Acme' } as never, lifeCycleStatus: 'EXPIRED' });
const all = [employeeAcme, employeeGlobex, machineAcme];

describe('credential filters', () => {
  describe('filterCredentials', () => {
    it('returns every credential when there is no filter', () => {
      expect(filterCredentials(all, NO_FILTERS)).toEqual(all);
    });

    it('filters by type', () => {
      expect(filterCredentials(all, { ...NO_FILTERS, type: 'Machine' })).toEqual([machineAcme]);
    });

    it('filters by issuer', () => {
      expect(filterCredentials(all, { ...NO_FILTERS, issuer: 'Globex' })).toEqual([employeeGlobex]);
    });

    it('filters by status', () => {
      expect(filterCredentials(all, { ...NO_FILTERS, status: 'EXPIRED' })).toEqual([machineAcme]);
    });

    it('combines the filters', () => {
      expect(filterCredentials(all, { type: 'Employee', issuer: 'Acme', status: 'VALID' })).toEqual([employeeAcme]);
      expect(filterCredentials(all, { type: 'Machine', issuer: 'Globex', status: '' })).toEqual([]);
    });

    it('identifies the issuer by id when it has no organization', () => {
      const bare = credential({ id: '4', name: 'Employee' });

      expect(filterCredentials([bare], { ...NO_FILTERS, issuer: 'did:issuer' })).toEqual([bare]);
    });

    it('names the type after the last type when the credential has no name', () => {
      const unnamed = credential({ id: '5', type: ['VerifiableCredential', 'LEARCredentialEmployee'] as never });

      expect(filterCredentials([unnamed], { ...NO_FILTERS, type: 'LEARCredentialEmployee' })).toEqual([unnamed]);
    });
  });

  describe('credentialStatusOf', () => {
    it('reports a valid credential whose expiry date has passed as expired', () => {
      expect(credentialStatusOf(credential({ validUntil: '2020-01-01T00:00:00.000Z' }))).toBe('EXPIRED');
    });

    it('reports a valid credential without a past expiry date as valid', () => {
      expect(credentialStatusOf(credential({ validUntil: '2099-01-01T00:00:00.000Z' }))).toBe('VALID');
      expect(credentialStatusOf(credential({}))).toBe('VALID');
    });

    it('reports revoked and expired as stored, even with a future expiry date', () => {
      expect(credentialStatusOf(credential({ lifeCycleStatus: 'REVOKED', validUntil: '2099-01-01T00:00:00.000Z' }))).toBe('REVOKED');
      expect(credentialStatusOf(credential({ lifeCycleStatus: 'EXPIRED' }))).toBe('EXPIRED');
    });

    it('gives an unsigned credential no filterable status', () => {
      expect(credentialStatusOf(credential({ lifeCycleStatus: 'ISSUED' }))).toBeNull();
      expect(filterCredentials([credential({ lifeCycleStatus: 'ISSUED' })], { ...NO_FILTERS, status: 'VALID' })).toEqual([]);
    });
  });

  describe('options', () => {
    it('lists the distinct types and issuers in alphabetical order, without blanks', () => {
      expect(distinctTypes([...all, credential({ id: '6' })])).toEqual(['Employee', 'Machine']);
      expect(distinctIssuers(all)).toEqual(['Acme', 'Globex']);
    });
  });

  describe('hasActiveFilters', () => {
    it('tells whether any filter is in use', () => {
      expect(hasActiveFilters(NO_FILTERS)).toBe(false);
      expect(hasActiveFilters({ ...NO_FILTERS, issuer: 'Acme' })).toBe(true);
    });
  });
});
