import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CredentialDisplayService } from './credential-display.service';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import { CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';
import { VerifiableCredential } from '../models/verifiable-credential';

function buildCredential(overrides: Partial<VerifiableCredential> = {}): VerifiableCredential {
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: 'urn:uuid:test-credential',
    type: ['VerifiableCredential', 'gx.labelcredential.w3c.2'],
    lifeCycleStatus: 'VALID',
    issuer: { id: 'did:key:issuer' },
    validFrom: '2026-01-01T00:00:00Z',
    validUntil: '2027-01-01T00:00:00Z',
    credentialSubject: {
      id: 'did:key:subject',
      'gx:labelLevel': 'P',
      'gx:engineVersion': '1.0',
      'gx:rulesVersion': '1.0',
      'gx:compliantCredentials': [],
      'gx:validatedCriteria': [],
    } as any,
    credentialStatus: {} as any,
    credentialFormat: 'JWT_VC',
    ...overrides,
  };
}

function buildLabelLevelMetadata(): CredentialMetadata {
  return {
    display: [{ name: 'Gaia-X Label Credential', locale: 'en' }],
    claims: [
      {
        path: ['credentialSubject', 'gx:labelLevel'],
        display: [{ name: 'Label Level', locale: 'en' }],
      },
      {
        path: ['credentialSubject', 'gx:engineVersion'],
        display: [{ name: 'Engine Version', locale: 'en' }],
      },
    ],
  };
}

function setup(findCredentialMetadata: jest.Mock) {
  TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot()],
    providers: [
      CredentialDisplayService,
      { provide: IssuerMetadataCacheService, useValue: { findCredentialMetadata } },
    ],
  });
  return TestBed.inject(CredentialDisplayService);
}

describe('CredentialDisplayService', () => {
  describe('resolveMetadata', () => {
    it('returns the issuer metadata when it has claims', async () => {
      const meta = buildLabelLevelMetadata();
      const findCredentialMetadata = jest.fn().mockResolvedValue(meta);
      const service = setup(findCredentialMetadata);

      const result = await service.resolveMetadata(buildCredential());

      expect(result).toBe(meta);
      expect(findCredentialMetadata).toHaveBeenCalledWith(
        'urn:uuid:test-credential',
        ['VerifiableCredential', 'gx.labelcredential.w3c.2'],
        'JWT_VC'
      );
    });

    it('returns the issuer metadata as-is even when claims is empty (display-only metadata)', async () => {
      const meta: CredentialMetadata = { display: [{ name: 'Display Only', locale: 'en' }], claims: [] };
      const findCredentialMetadata = jest.fn().mockResolvedValue(meta);
      const service = setup(findCredentialMetadata);

      const result = await service.resolveMetadata(buildCredential());

      expect(result).toBe(meta);
    });

    it('returns null when the issuer metadata cache has nothing for this credential', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue(null);
      const service = setup(findCredentialMetadata);

      const result = await service.resolveMetadata(buildCredential());

      expect(result).toBeNull();
    });
  });

  describe('buildFieldsFromClaims', () => {
    it('renders the claim value as published by the issuer', () => {
      const service = setup(jest.fn());
      const credential = buildCredential();

      const fields = service.buildFieldsFromClaims(credential.credentialSubject, buildLabelLevelMetadata());

      expect(fields).toContainEqual({ label: 'Label Level', value: 'P' });
    });

    it('renders every scalar claim of the metadata', () => {
      const service = setup(jest.fn());
      const credential = buildCredential();

      const fields = service.buildFieldsFromClaims(credential.credentialSubject, buildLabelLevelMetadata());

      expect(fields).toContainEqual({ label: 'Engine Version', value: '1.0' });
    });
  });

  describe('getCardFields', () => {
    it('summarises the scalar claims in metadata order', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue(buildLabelLevelMetadata());
      const service = setup(findCredentialMetadata);

      const fields = await service.getCardFields(buildCredential());

      expect(fields).toEqual([
        { label: 'Label Level', value: 'P' },
        { label: 'Engine Version', value: '1.0' },
      ]);
    });

    it('returns an empty array when there is no resolvable metadata', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue(null);
      const service = setup(findCredentialMetadata);

      const fields = await service.getCardFields(buildCredential());

      expect(fields).toEqual([]);
    });

    it('returns an empty array for display-only metadata (no claims)', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue({ display: [{ name: 'Display Only', locale: 'en' }], claims: [] });
      const service = setup(findCredentialMetadata);

      const fields = await service.getCardFields(buildCredential());

      expect(fields).toEqual([]);
    });
  });

  describe('createSectionsFromClaims', () => {
    it('groups the claim values as published by the issuer', () => {
      const service = setup(jest.fn());
      const credential = buildCredential();

      const sections = service.createSectionsFromClaims(credential.credentialSubject, buildLabelLevelMetadata());

      const allFields = sections.flatMap(s => s.fields);
      expect(allFields).toContainEqual({ label: 'Label Level', value: 'P' });
    });
  });

  describe('getDisplayName', () => {
    it('resolves the display name from issuer metadata', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue(buildLabelLevelMetadata());
      const service = setup(findCredentialMetadata);

      const name = await service.getDisplayName(buildCredential());

      expect(name).toBe('Gaia-X Label Credential');
    });

    it('falls back to the credential type when there is no metadata', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue(null);
      const service = setup(findCredentialMetadata);

      const name = await service.getDisplayName(buildCredential());

      expect(name).toBe('gx.labelcredential.w3c.2');
    });

    it('resolves the display name from display-only metadata (no claims)', async () => {
      const findCredentialMetadata = jest.fn().mockResolvedValue({ display: [{ name: 'Display Only', locale: 'en' }], claims: [] });
      const service = setup(findCredentialMetadata);

      const name = await service.getDisplayName(buildCredential());

      expect(name).toBe('Display Only');
    });
  });
});
