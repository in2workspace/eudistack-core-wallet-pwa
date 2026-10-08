import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { Storage } from '@ionic/storage-angular';
import { of, throwError } from 'rxjs';
import { IssuerMetadataCacheService } from './issuer-metadata-cache.service';
import {
  CredentialIssuerMetadata,
  CredentialMetadata,
  CredentialsConfigurationsSuppported,
} from '../models/dto/CredentialIssuerMetadata';

const ISSUER = 'https://issuer.example';
const OTHER_ISSUER = 'https://other-issuer.example';
const WELL_KNOWN = ISSUER + '/.well-known/openid-credential-issuer';
const TTL_MS = 24 * 60 * 60 * 1000;

function buildMetadataDisplay(name: string): CredentialMetadata {
  return {
    display: [{ name, locale: 'es-ES' }],
    claims: [],
  };
}

function buildIssuerMetadata(
  configs: Record<string, Partial<CredentialsConfigurationsSuppported>>
): CredentialIssuerMetadata {
  return {
    credential_configurations_supported: configs as Record<string, CredentialsConfigurationsSuppported>,
  };
}

describe('IssuerMetadataCacheService', () => {
  let service: IssuerMetadataCacheService;
  let store: Map<string, unknown>;
  let storageCreate: jest.Mock;
  let storageGet: jest.Mock;
  let storageSet: jest.Mock;
  let httpGet: jest.Mock;

  beforeEach(() => {
    store = new Map<string, unknown>();
    storageCreate = jest.fn().mockResolvedValue(undefined);
    storageGet = jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null));
    storageSet = jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
      return value;
    });
    httpGet = jest.fn();

    jest.spyOn(console, 'debug').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        IssuerMetadataCacheService,
        { provide: Storage, useValue: { create: storageCreate, get: storageGet, set: storageSet } },
        { provide: HttpClient, useValue: { get: httpGet } },
      ],
    });

    service = TestBed.inject(IssuerMetadataCacheService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('storage initialisation', () => {
    it('creates the storage on first use', async () => {
      await service.findKnownIssuers();

      expect(storageCreate).toHaveBeenCalledTimes(1);
    });

    it('reuses the same initialisation across calls', async () => {
      await service.findKnownIssuers();
      await service.findKnownIssuers();
      await service.refreshStaleMetadata();

      expect(storageCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('registerIssuance', () => {
    it('stores the issuer metadata, the credential mapping and the issuer in the known list', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-01T00:00:00.000Z'));
      const metadata = buildIssuerMetadata({ 'doctorid.sd.1': { format: 'dc+sd-jwt' } });

      await service.registerIssuance('urn:uuid:cred-1', ISSUER, 'doctorid.sd.1', metadata);

      expect(store.get('issuer-meta:' + ISSUER)).toEqual({
        metadata,
        fetchedAt: Date.parse('2026-05-01T00:00:00.000Z'),
      });
      expect(store.get('cred-issuer:urn:uuid:cred-1')).toEqual({
        issuerUrl: ISSUER,
        configId: 'doctorid.sd.1',
      });
      expect(store.get('known-issuers')).toEqual([ISSUER]);
    });

    it('appends to an existing known-issuers list', async () => {
      store.set('known-issuers', [OTHER_ISSUER]);

      await service.registerIssuance('urn:uuid:cred-1', ISSUER, 'c1', buildIssuerMetadata({}));

      expect(store.get('known-issuers')).toEqual([OTHER_ISSUER, ISSUER]);
    });

    it('does not duplicate an issuer that is already known', async () => {
      store.set('known-issuers', [ISSUER]);

      await service.registerIssuance('urn:uuid:cred-2', ISSUER, 'c1', buildIssuerMetadata({}));

      expect(store.get('known-issuers')).toEqual([ISSUER]);
      expect(storageSet).not.toHaveBeenCalledWith('known-issuers', expect.anything());
    });
  });

  describe('findCredentialMetadata by direct mapping', () => {
    it('resolves the metadata through the credential to issuer mapping', async () => {
      const credentialMetadata = buildMetadataDisplay('DoctorID');
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'doctorid.sd.1' });
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({
          'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: credentialMetadata },
        }),
        fetchedAt: Date.now(),
      });

      await expect(service.findCredentialMetadata('urn:uuid:cred-1')).resolves.toBe(
        credentialMetadata
      );
    });

    it('returns null when there is no mapping and no credential types to fall back on', async () => {
      await expect(service.findCredentialMetadata('urn:uuid:unknown')).resolves.toBeNull();
    });

    it('returns null when the mapping points at an issuer with no cached metadata', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'c1' });

      await expect(service.findCredentialMetadata('urn:uuid:cred-1')).resolves.toBeNull();
    });

    it('returns null when the mapped configuration is absent from the metadata', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'missing-config' });
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({ 'other-config': { format: 'dc+sd-jwt' } }),
        fetchedAt: Date.now(),
      });

      await expect(service.findCredentialMetadata('urn:uuid:cred-1')).resolves.toBeNull();
    });

    it('returns null when the mapped configuration carries no credential_metadata', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'c1' });
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({ c1: { format: 'dc+sd-jwt' } }),
        fetchedAt: Date.now(),
      });

      await expect(service.findCredentialMetadata('urn:uuid:cred-1')).resolves.toBeNull();
    });

    it('returns null when the cached metadata has no configurations at all', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'c1' });
      store.set('issuer-meta:' + ISSUER, { metadata: {}, fetchedAt: Date.now() });

      await expect(service.findCredentialMetadata('urn:uuid:cred-1')).resolves.toBeNull();
    });

    it('ignores an empty credential type list', async () => {
      await expect(service.findCredentialMetadata('urn:uuid:unknown', [])).resolves.toBeNull();
    });
  });

  describe('findCredentialMetadata by type across known issuers', () => {
    const seedIssuer = (
      url: string,
      configs: Record<string, Partial<CredentialsConfigurationsSuppported>>
    ) => {
      const known = (store.get('known-issuers') as string[]) ?? [];
      store.set('known-issuers', [...known, url]);
      store.set('issuer-meta:' + url, {
        metadata: buildIssuerMetadata(configs),
        fetchedAt: Date.now(),
      });
    };

    it('matches by configuration id', async () => {
      const credentialMetadata = buildMetadataDisplay('By config id');
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: credentialMetadata },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'])
      ).resolves.toBe(credentialMetadata);
    });

    it('matches by credential_definition type', async () => {
      const credentialMetadata = buildMetadataDisplay('By definition type');
      seedIssuer(ISSUER, {
        'some-config': {
          format: 'jwt_vc_json',
          credential_definition: { type: ['VerifiableCredential', 'LEARCredentialEmployee'] },
          credential_metadata: credentialMetadata,
        },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', [
          'VerifiableCredential',
          'LEARCredentialEmployee',
        ])
      ).resolves.toBe(credentialMetadata);
    });

    it('matches by vct', async () => {
      const credentialMetadata = buildMetadataDisplay('By vct');
      seedIssuer(ISSUER, {
        'some-config': {
          format: 'dc+sd-jwt',
          vct: 'urn:es.cgcom:doctorid:1',
          credential_metadata: credentialMetadata,
        },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['urn:es.cgcom:doctorid:1'])
      ).resolves.toBe(credentialMetadata);
    });

    it('translates the backend format enum to the OID4VCI protocol format', async () => {
      const credentialMetadata = buildMetadataDisplay('SD-JWT');
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: credentialMetadata },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'], 'DC_SD_JWT')
      ).resolves.toBe(credentialMetadata);
    });

    it('passes an unmapped format through unchanged', async () => {
      const credentialMetadata = buildMetadataDisplay('Already protocol format');
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: credentialMetadata },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'], 'dc+sd-jwt')
      ).resolves.toBe(credentialMetadata);
    });

    it('skips configurations whose format differs from the requested one', async () => {
      seedIssuer(ISSUER, {
        'doctorid.sd.1': {
          format: 'jwt_vc_json',
          credential_metadata: buildMetadataDisplay('Wrong format'),
        },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'], 'DC_SD_JWT')
      ).resolves.toBeNull();
    });

    it('returns null when the only requested type is the generic VerifiableCredential', async () => {
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: buildMetadataDisplay('x') },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['VerifiableCredential'])
      ).resolves.toBeNull();
    });

    it('does not match a credential_definition that only carries VerifiableCredential', async () => {
      seedIssuer(ISSUER, {
        'some-config': {
          format: 'dc+sd-jwt',
          credential_definition: { type: ['VerifiableCredential'] },
          credential_metadata: buildMetadataDisplay('generic'),
        },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', [
          'VerifiableCredential',
          'UnknownType',
        ])
      ).resolves.toBeNull();
    });

    it('skips a matching configuration that carries no credential_metadata', async () => {
      seedIssuer(ISSUER, { 'doctorid.sd.1': { format: 'dc+sd-jwt' } });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'])
      ).resolves.toBeNull();
    });

    it('skips known issuers with no cached metadata and keeps searching', async () => {
      const credentialMetadata = buildMetadataDisplay('Second issuer');
      store.set('known-issuers', [OTHER_ISSUER]);
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: credentialMetadata },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'])
      ).resolves.toBe(credentialMetadata);
    });

    it('skips cached entries whose metadata has no configurations', async () => {
      store.set('known-issuers', [OTHER_ISSUER]);
      store.set('issuer-meta:' + OTHER_ISSUER, { metadata: {}, fetchedAt: Date.now() });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'])
      ).resolves.toBeNull();
    });

    it('returns null when there is no known issuer to search', async () => {
      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['doctorid.sd.1'])
      ).resolves.toBeNull();
    });

    it('returns null when no known issuer matches', async () => {
      seedIssuer(ISSUER, {
        'doctorid.sd.1': { format: 'dc+sd-jwt', credential_metadata: buildMetadataDisplay('x') },
      });

      await expect(
        service.findCredentialMetadata('urn:uuid:unmapped', ['SomethingElse'])
      ).resolves.toBeNull();
    });
  });

  describe('findCredentialDisplayName', () => {
    it('returns the name of the first display entry', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'c1' });
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({
          c1: { format: 'dc+sd-jwt', credential_metadata: buildMetadataDisplay('Carné colegial') },
        }),
        fetchedAt: Date.now(),
      });

      await expect(service.findCredentialDisplayName('urn:uuid:cred-1')).resolves.toBe(
        'Carné colegial'
      );
    });

    it('returns null when no metadata is found', async () => {
      await expect(service.findCredentialDisplayName('urn:uuid:unknown')).resolves.toBeNull();
    });

    it('returns null when the metadata carries no display entries', async () => {
      store.set('cred-issuer:urn:uuid:cred-1', { issuerUrl: ISSUER, configId: 'c1' });
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({
          c1: {
            format: 'dc+sd-jwt',
            credential_metadata: { display: [], claims: [] } as CredentialMetadata,
          },
        }),
        fetchedAt: Date.now(),
      });

      await expect(service.findCredentialDisplayName('urn:uuid:cred-1')).resolves.toBeNull();
    });
  });

  describe('fetchAndCacheIfMissing', () => {
    it('is a no-op when the issuer is already cached', async () => {
      store.set('issuer-meta:' + ISSUER, { metadata: buildIssuerMetadata({}), fetchedAt: 1 });

      await service.fetchAndCacheIfMissing(ISSUER);

      expect(httpGet).not.toHaveBeenCalled();
    });

    it('fetches, parses and caches the well-known metadata', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-05-02T00:00:00.000Z'));
      const metadata = buildIssuerMetadata({ c1: { format: 'dc+sd-jwt' } });
      httpGet.mockReturnValue(of(JSON.stringify(metadata)));

      await service.fetchAndCacheIfMissing(ISSUER);

      expect(httpGet).toHaveBeenCalledWith(WELL_KNOWN, { responseType: 'text' });
      expect(store.get('issuer-meta:' + ISSUER)).toEqual({
        metadata,
        fetchedAt: Date.parse('2026-05-02T00:00:00.000Z'),
      });
      expect(store.get('known-issuers')).toEqual([ISSUER]);
    });

    it('does not duplicate an issuer already present in the known list', async () => {
      store.set('known-issuers', [ISSUER]);
      httpGet.mockReturnValue(of(JSON.stringify(buildIssuerMetadata({}))));

      await service.fetchAndCacheIfMissing(ISSUER);

      expect(store.get('known-issuers')).toEqual([ISSUER]);
    });

    it('swallows a transport failure so the OID4VP flow is not broken', async () => {
      httpGet.mockReturnValue(throwError(() => new Error('network down')));

      await expect(service.fetchAndCacheIfMissing(ISSUER)).resolves.toBeUndefined();

      expect(store.has('issuer-meta:' + ISSUER)).toBe(false);
      expect(console.warn).toHaveBeenCalled();
    });

    it('swallows malformed metadata', async () => {
      httpGet.mockReturnValue(of('not json'));

      await expect(service.fetchAndCacheIfMissing(ISSUER)).resolves.toBeUndefined();

      expect(store.has('issuer-meta:' + ISSUER)).toBe(false);
    });
  });

  describe('refreshStaleMetadata', () => {
    it('does nothing when there are no known issuers', async () => {
      await service.refreshStaleMetadata();

      expect(httpGet).not.toHaveBeenCalled();
    });

    it('refreshes an entry older than the 24h TTL', async () => {
      const now = Date.parse('2026-05-10T00:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      store.set('known-issuers', [ISSUER]);
      store.set('issuer-meta:' + ISSUER, {
        metadata: buildIssuerMetadata({}),
        fetchedAt: now - TTL_MS - 1,
      });
      const refreshed = buildIssuerMetadata({ c1: { format: 'dc+sd-jwt' } });
      httpGet.mockReturnValue(of(JSON.stringify(refreshed)));

      await service.refreshStaleMetadata();

      expect(store.get('issuer-meta:' + ISSUER)).toEqual({ metadata: refreshed, fetchedAt: now });
    });

    it('leaves an entry within the TTL untouched', async () => {
      const now = Date.parse('2026-05-10T00:00:00.000Z');
      jest.useFakeTimers().setSystemTime(now);
      store.set('known-issuers', [ISSUER]);
      const fresh = { metadata: buildIssuerMetadata({}), fetchedAt: now - TTL_MS + 1000 };
      store.set('issuer-meta:' + ISSUER, fresh);

      await service.refreshStaleMetadata();

      expect(httpGet).not.toHaveBeenCalled();
      expect(store.get('issuer-meta:' + ISSUER)).toBe(fresh);
    });

    it('fetches metadata for a known issuer that has no cached entry', async () => {
      store.set('known-issuers', [ISSUER]);
      httpGet.mockReturnValue(of(JSON.stringify(buildIssuerMetadata({}))));

      await service.refreshStaleMetadata();

      expect(httpGet).toHaveBeenCalledWith(WELL_KNOWN, { responseType: 'text' });
    });

    it('keeps refreshing the remaining issuers when one fails', async () => {
      store.set('known-issuers', [ISSUER, OTHER_ISSUER]);
      httpGet
        .mockReturnValueOnce(throwError(() => new Error('boom')))
        .mockReturnValueOnce(of(JSON.stringify(buildIssuerMetadata({}))));

      await service.refreshStaleMetadata();

      expect(httpGet).toHaveBeenCalledTimes(2);
      expect(store.has('issuer-meta:' + ISSUER)).toBe(false);
      expect(store.has('issuer-meta:' + OTHER_ISSUER)).toBe(true);
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe('findKnownIssuers', () => {
    it('returns an empty list when nothing has been registered', async () => {
      await expect(service.findKnownIssuers()).resolves.toEqual([]);
    });

    it('wraps every known issuer url into an object', async () => {
      store.set('known-issuers', [ISSUER, OTHER_ISSUER]);

      await expect(service.findKnownIssuers()).resolves.toEqual([
        { url: ISSUER },
        { url: OTHER_ISSUER },
      ]);
    });
  });
});
