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

  describe('claims filtering (issuer_access power gate)', () => {
    const onboardingExecuteQuery: DcqlQuery = {
      credentials: [{
        id: 'issuer_access_employee_sd_jwt',
        format: 'dc+sd-jwt',
        meta: { vct_values: ['learcredential.employee.sd.1'] },
        claims: [
          { path: ['mandate', 'power', '*', 'function'], values: ['Onboarding'] },
          { path: ['mandate', 'power', '*', 'action'], values: ['Execute'] },
        ],
      }],
    } as unknown as DcqlQuery;

    const sysAdminQuery: DcqlQuery = {
      credentials: [{
        id: 'issuer_access_sysadmin_sd_jwt',
        format: 'dc+sd-jwt',
        meta: { vct_values: ['learcredential.employee.sd.1'] },
        claims: [
          { path: ['mandate', 'power', '*', 'type'], values: ['organization'] },
          { path: ['mandate', 'power', '*', 'domain'], values: ['EUDISTACK'] },
          { path: ['mandate', 'power', '*', 'function'], values: ['System'] },
          { path: ['mandate', 'power', '*', 'action'], values: ['Administration'] },
        ],
      }],
    } as unknown as DcqlQuery;

    function makeEmployeeSdJwt(power: unknown[]): VerifiableCredential {
      return makeCredential({
        id: 'employee',
        type: ['VerifiableCredential', 'learcredential.employee.sd.1'],
        credentialSubject: { mandate: { power } } as any,
      });
    }

    it('includes an employee credential whose power has Onboarding+Execute together', () => {
      const cred = makeEmployeeSdJwt([
        { type: 'domain', domain: 'SANDBOX', function: 'Onboarding', action: ['Execute'] },
      ]);
      service.setLoaded([cred]);

      expect(service.findCredentialsByDcqlQuery(onboardingExecuteQuery).map(c => c.id)).toEqual(['employee']);
    });

    it('excludes an employee credential whose power lacks Onboarding entirely', () => {
      const cred = makeEmployeeSdJwt([
        { type: 'domain', domain: 'SANDBOX', function: 'ProductOffering', action: ['Create', 'Update', 'Delete'] },
      ]);
      service.setLoaded([cred]);

      expect(service.findCredentialsByDcqlQuery(onboardingExecuteQuery)).toEqual([]);
    });

    it('does NOT include a credential when Onboarding and Execute sit on two different, unrelated powers', () => {
      // Regression test: function=Onboarding and action=Execute must be satisfied by the SAME
      // array element, not by two independent powers that each satisfy half the requirement.
      const cred = makeEmployeeSdJwt([
        { type: 'domain', domain: 'SANDBOX', function: 'Onboarding', action: ['View'] },
        { type: 'domain', domain: 'SANDBOX', function: 'ProductOffering', action: ['Execute'] },
      ]);
      service.setLoaded([cred]);

      expect(service.findCredentialsByDcqlQuery(onboardingExecuteQuery)).toEqual([]);
    });

    it('includes a SysAdmin credential via the sysadmin alternative query', () => {
      const cred = makeEmployeeSdJwt([
        { type: 'organization', domain: 'EUDISTACK', function: 'System', action: ['Administration'] },
      ]);
      service.setLoaded([cred]);

      expect(service.findCredentialsByDcqlQuery(sysAdminQuery).map(c => c.id)).toEqual(['employee']);
    });

    it('matches when action is a plain string instead of an array', () => {
      const cred = makeEmployeeSdJwt([
        { type: 'domain', domain: 'SANDBOX', function: 'Onboarding', action: 'Execute' },
      ]);
      service.setLoaded([cred]);

      expect(service.findCredentialsByDcqlQuery(onboardingExecuteQuery).map(c => c.id)).toEqual(['employee']);
    });

    it('matches a standalone (non-wildcard) claim, same shape used by the doctorid profile', () => {
      const cred = makeCredential({
        id: 'doctorid',
        type: ['VerifiableCredential', 'urn:es.cgcom:doctorid:1'],
        credentialSubject: { registrationNumber: '12345' } as any,
      });
      service.setLoaded([cred]);

      const query: DcqlQuery = {
        credentials: [{
          id: 'doctorid_sd_jwt',
          format: 'dc+sd-jwt',
          meta: { vct_values: ['urn:es.cgcom:doctorid:1'] },
          claims: [{ path: ['registrationNumber'] }],
        }],
      } as unknown as DcqlQuery;

      expect(service.findCredentialsByDcqlQuery(query).map(c => c.id)).toEqual(['doctorid']);
    });

    it('excludes a credential missing a required standalone (non-wildcard) claim', () => {
      const cred = makeCredential({
        id: 'doctorid',
        type: ['VerifiableCredential', 'urn:es.cgcom:doctorid:1'],
        credentialSubject: {} as any,
      });
      service.setLoaded([cred]);

      const query: DcqlQuery = {
        credentials: [{
          id: 'doctorid_sd_jwt',
          format: 'dc+sd-jwt',
          meta: { vct_values: ['urn:es.cgcom:doctorid:1'] },
          claims: [{ path: ['registrationNumber'] }],
        }],
      } as unknown as DcqlQuery;

      expect(service.findCredentialsByDcqlQuery(query)).toEqual([]);
    });

    it('resolves claim paths under credentialSubject for jwt_vc_json credentials', () => {
      const cred = makeCredential({
        id: 'employee-w3c',
        type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
        credentialSubject: {
          mandate: { power: [{ type: 'domain', domain: 'SANDBOX', function: 'Onboarding', action: ['Execute'] }] },
        } as any,
      });
      service.setLoaded([cred]);

      const query: DcqlQuery = {
        credentials: [{
          id: 'issuer_access_employee_jwt_vc',
          format: 'jwt_vc_json',
          meta: { credential_definition: { type: ['learcredential.employee.w3c.4'] } },
          claims: [
            { path: ['credentialSubject', 'mandate', 'power', '*', 'function'], values: ['Onboarding'] },
            { path: ['credentialSubject', 'mandate', 'power', '*', 'action'], values: ['Execute'] },
          ],
        }],
      } as unknown as DcqlQuery;

      expect(service.findCredentialsByDcqlQuery(query).map(c => c.id)).toEqual(['employee-w3c']);
    });
  });
});
