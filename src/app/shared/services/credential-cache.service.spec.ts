import { TestBed } from '@angular/core/testing';
import { CredentialCacheService } from './credential-cache.service';
import { VerifiableCredential } from '../../core/models/verifiable-credential';
import { DcqlQuery } from '../../core/protocol/oid4vp/authorization-request.model';

function makeCredential(overrides: Partial<VerifiableCredential> = {}): VerifiableCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v1'],
    id: 'cred-1',
    type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
    issuer: { id: 'did:web:issuer' },
    validFrom: '2024-01-01T00:00:00Z',
    validUntil: '2030-01-01T00:00:00Z',
    credentialSubject: {},
    lifeCycleStatus: 'VALID',
    credentialEncoded: 'signed.jwt.value',
    ...overrides,
  } as VerifiableCredential;
}

describe('CredentialCacheService', () => {
  let service: CredentialCacheService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CredentialCacheService] });
    service = TestBed.inject(CredentialCacheService);
  });

  describe('state transitions', () => {
    it('starts idle with an empty list', () => {
      expect(service.status()).toBe('idle');
      expect(service.credentials()).toEqual([]);
    });

    it('setLoaded replaces the list and marks loaded', () => {
      const cred = makeCredential();
      service.setLoaded([cred]);
      expect(service.status()).toBe('loaded');
      expect(service.credentials()).toEqual([cred]);
    });

    it('setLoading keeps the current list', () => {
      service.setLoaded([makeCredential()]);
      service.setLoading();
      expect(service.status()).toBe('loading');
      expect(service.credentials().length).toBe(1);
    });

    it('setError keeps the current list (does not blank the wallet)', () => {
      service.setLoaded([makeCredential()]);
      service.setError();
      expect(service.status()).toBe('error');
      expect(service.credentials().length).toBe(1);
    });

    it('patchStatus updates only the matching credential immutably', () => {
      const cred = makeCredential({ id: 'cred-1' });
      service.setLoaded([cred, makeCredential({ id: 'cred-2' })]);

      service.patchStatus('cred-1', 'REVOKED');

      const list = service.credentials();
      expect(list.find(c => c.id === 'cred-1')?.lifeCycleStatus).toBe('REVOKED');
      expect(list.find(c => c.id === 'cred-2')?.lifeCycleStatus).toBe('VALID');
      // original object not mutated in place
      expect(cred.lifeCycleStatus).toBe('VALID');
    });

    it('remove drops the credential by id', () => {
      service.setLoaded([makeCredential({ id: 'cred-1' }), makeCredential({ id: 'cred-2' })]);
      service.remove('cred-1');
      expect(service.credentials().map(c => c.id)).toEqual(['cred-2']);
    });

    it('snapshot returns the current state synchronously', () => {
      service.setLoaded([makeCredential()]);
      expect(service.snapshot().status).toBe('loaded');
      expect(service.snapshot().credentials.length).toBe(1);
    });
  });

  describe('matchers', () => {
    it('findCredentialsByScope matches VALID credentials of the mapped type', () => {
      const employee = makeCredential({ id: 'e', type: ['VerifiableCredential', 'learcredential.employee.w3c.4'] });
      const other = makeCredential({ id: 'o', type: ['VerifiableCredential', 'gx:LabelCredential'] });
      service.setLoaded([employee, other]);

      const result = service.findCredentialsByScope(['learcredential.employee']);
      expect(result.map(c => c.id)).toEqual(['e']);
    });

    it('findCredentialsByScope excludes non-VALID credentials', () => {
      service.setLoaded([makeCredential({ id: 'e', lifeCycleStatus: 'REVOKED' })]);
      expect(service.findCredentialsByScope(['learcredential.employee'])).toEqual([]);
    });

    it('findCredentialsByScope returns [] for an unmapped scope', () => {
      service.setLoaded([makeCredential()]);
      expect(service.findCredentialsByScope(['unknown.scope'])).toEqual([]);
    });

    it('findCredentialsByDcqlQuery matches by jwt_vc_json credential_definition type and dedupes', () => {
      const cred = makeCredential({ id: 'e', type: ['VerifiableCredential', 'learcredential.employee.w3c.4'] });
      service.setLoaded([cred]);

      const query: DcqlQuery = {
        credentials: [
          { id: 'q1', format: 'jwt_vc_json', meta: { credential_definition: { type: ['learcredential.employee.w3c.4'] } } },
          { id: 'q2', format: 'jwt_vc_json', meta: { credential_definition: { type: ['learcredential.employee.w3c.4'] } } },
        ],
      } as unknown as DcqlQuery;

      const result = service.findCredentialsByDcqlQuery(query);
      expect(result.map(c => c.id)).toEqual(['e']); // deduped
    });

    it('extractSignedJwt returns the encoded credential', () => {
      const cred = makeCredential({ credentialEncoded: 'abc.def.ghi' });
      expect(service.extractSignedJwt(cred)).toBe('abc.def.ghi');
    });
  });
});
