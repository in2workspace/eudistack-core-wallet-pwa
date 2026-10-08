import { TestBed } from '@angular/core/testing';
import { CredentialParserService } from './credential-parser.util';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { SdJwtParserService } from '../protocol/oid4vci/sd-jwt-parser.service';
import { CredentialResponse } from '../models/dto/CredentialResponse';

const FIXED_UUID = '11111111-2222-4333-8444-555555555555';

const EMPTY_STATUS = {
  id: '',
  type: '',
  statusPurpose: '',
  statusListIndex: '',
  statusListCredential: '',
};

describe('CredentialParserService', () => {
  let service: CredentialParserService;
  let extractJwtPayload: jest.Mock;
  let isSdJwt: jest.Mock;
  let reconstructClaims: jest.Mock;
  let randomUUID: jest.SpyInstance;

  beforeEach(() => {
    extractJwtPayload = jest.fn();
    isSdJwt = jest.fn().mockReturnValue(false);
    reconstructClaims = jest.fn();

    TestBed.configureTestingModule({
      providers: [
        CredentialParserService,
        { provide: JwtService, useValue: { extractJwtPayload } },
        { provide: SdJwtParserService, useValue: { isSdJwt, reconstructClaims } },
      ],
    });

    service = TestBed.inject(CredentialParserService);
    randomUUID = jest.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIXED_UUID);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  const parseJwt = (vc: Record<string, unknown>) => {
    extractJwtPayload.mockReturnValue({ vc });
    return service.parseRawCredential('a.b.c', 'jwt_vc_json');
  };

  const parseSdJwt = (payload: Record<string, unknown>) => {
    isSdJwt.mockReturnValue(true);
    reconstructClaims.mockReturnValue({ payload, issuerJwt: 'issuer-jwt' });
    return service.parseRawCredential('compact~sd~jwt', 'dc+sd-jwt');
  };

  describe('parseCredentialResponse', () => {
    it('parses the first credential of the response', () => {
      extractJwtPayload.mockReturnValue({ vc: { id: 'urn:uuid:first' } });
      const response: CredentialResponse = {
        credentials: [{ credential: 'jwt-one' }, { credential: 'jwt-two' }],
      };

      const result = service.parseCredentialResponse(response, 'jwt_vc_json');

      expect(result.id).toBe('urn:uuid:first');
      expect(result.credentialEncoded).toBe('jwt-one');
      expect(result.credentialFormat).toBe('jwt_vc_json');
    });

    it('throws when the credentials array is absent', () => {
      expect(() => service.parseCredentialResponse({}, 'jwt_vc_json')).toThrow(
        'No credential found in response'
      );
    });

    it('throws when the credentials array is empty', () => {
      expect(() => service.parseCredentialResponse({ credentials: [] }, 'jwt_vc_json')).toThrow(
        'No credential found in response'
      );
    });

    it('throws when the first entry carries an empty credential', () => {
      expect(() =>
        service.parseCredentialResponse({ credentials: [{ credential: '' }] }, 'jwt_vc_json')
      ).toThrow('No credential found in response');
    });
  });

  describe('parseRawCredential routing', () => {
    it('routes to the SD-JWT parser when the parser recognises the format', () => {
      parseSdJwt({ jti: 'urn:uuid:sd' });

      expect(reconstructClaims).toHaveBeenCalledWith('compact~sd~jwt');
      expect(extractJwtPayload).not.toHaveBeenCalled();
    });

    it('routes to the plain JWT parser otherwise', () => {
      parseJwt({});

      expect(extractJwtPayload).toHaveBeenCalledWith('a.b.c');
      expect(reconstructClaims).not.toHaveBeenCalled();
    });
  });

  describe('plain JWT credentials', () => {
    it('reads the credential from the vc claim when present', () => {
      extractJwtPayload.mockReturnValue({
        iss: 'did:key:outer',
        vc: {
          '@context': ['https://www.w3.org/ns/credentials/v2'],
          id: 'urn:uuid:inner',
          type: ['VerifiableCredential', 'LEARCredentialEmployee'],
          issuer: { id: 'did:key:inner' },
          name: 'Employee',
          description: 'An employee credential',
          credentialSubject: { id: 'did:key:subject' },
          validFrom: '2026-01-01T00:00:00Z',
          validUntil: '2027-01-01T00:00:00Z',
        },
      });

      const result = service.parseRawCredential('a.b.c', 'jwt_vc_json');

      expect(result).toEqual({
        '@context': ['https://www.w3.org/ns/credentials/v2'],
        id: 'urn:uuid:inner',
        type: ['VerifiableCredential', 'LEARCredentialEmployee'],
        lifeCycleStatus: 'VALID',
        name: 'Employee',
        description: 'An employee credential',
        issuer: { id: 'did:key:inner' },
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2027-01-01T00:00:00Z',
        credentialSubject: { id: 'did:key:subject' },
        credentialStatus: EMPTY_STATUS,
        credentialEncoded: 'a.b.c',
        credentialFormat: 'jwt_vc_json',
      });
    });

    it('falls back to the whole payload when there is no vc claim', () => {
      extractJwtPayload.mockReturnValue({ id: 'urn:uuid:flat', iss: 'did:key:flat' });

      const result = service.parseRawCredential('a.b.c', 'jwt_vc_json');

      expect(result.id).toBe('urn:uuid:flat');
      expect(result.issuer).toEqual({ id: 'did:key:flat' });
    });

    it('falls back to the jti claim when there is no id', () => {
      expect(parseJwt({ jti: 'urn:uuid:from-jti' }).id).toBe('urn:uuid:from-jti');
    });

    it('mints a urn:uuid identifier when neither id nor jti is present', () => {
      expect(parseJwt({}).id).toBe('urn:uuid:' + FIXED_UUID);
      expect(randomUUID).toHaveBeenCalled();
    });

    it('defaults the context to the W3C v1 credentials context', () => {
      expect(parseJwt({ id: 'urn:uuid:no-context' })['@context']).toEqual([
        'https://www.w3.org/2018/credentials/v1',
      ]);
    });

    it('defaults the credential subject to an empty object', () => {
      expect(parseJwt({ id: 'urn:uuid:no-subject' }).credentialSubject).toEqual({});
    });

    it('always reports a VALID lifecycle because the parsing is client-side', () => {
      expect(parseJwt({ id: 'urn:uuid:x', lifeCycleStatus: 'REVOKED' }).lifeCycleStatus).toBe(
        'VALID'
      );
    });
  });

  describe('type extraction', () => {
    it('keeps an array of types as-is', () => {
      expect(parseJwt({ type: ['VerifiableCredential', 'LEARCredentialMachine'] }).type).toEqual([
        'VerifiableCredential',
        'LEARCredentialMachine',
      ]);
    });

    it('wraps a single string type alongside VerifiableCredential', () => {
      expect(parseJwt({ type: 'gx.labelcredential.w3c.2' }).type).toEqual([
        'VerifiableCredential',
        'gx.labelcredential.w3c.2',
      ]);
    });

    it('falls back to the vct claim when there is no type', () => {
      expect(parseJwt({ vct: 'urn:es.cgcom:doctorid:1' }).type).toEqual([
        'VerifiableCredential',
        'urn:es.cgcom:doctorid:1',
      ]);
    });

    it('defaults to VerifiableCredential when the type is neither array nor string', () => {
      expect(parseJwt({ type: 42 }).type).toEqual(['VerifiableCredential']);
      expect(parseJwt({}).type).toEqual(['VerifiableCredential']);
    });
  });

  describe('issuer extraction', () => {
    it('wraps a string issuer into an Issuer object', () => {
      expect(parseJwt({ issuer: 'did:key:string-issuer' }).issuer).toEqual({
        id: 'did:key:string-issuer',
      });
    });

    it('falls back to the iss claim when there is no issuer', () => {
      expect(parseJwt({ iss: 'did:key:iss-claim' }).issuer).toEqual({ id: 'did:key:iss-claim' });
    });

    it('maps every organisational attribute of an object issuer', () => {
      expect(
        parseJwt({
          issuer: {
            id: 'did:elsi:VATES-B123',
            organization: 'EUDIStack',
            organizationIdentifier: 'VATES-B123',
            country: 'ES',
            commonName: 'EUDIStack CA',
            serialNumber: 'IDCES-12345',
          },
        }).issuer
      ).toEqual({
        id: 'did:elsi:VATES-B123',
        organization: 'EUDIStack',
        organizationIdentifier: 'VATES-B123',
        country: 'ES',
        commonName: 'EUDIStack CA',
        serialNumber: 'IDCES-12345',
      });
    });

    it('reads the nested iss when an object issuer carries no id', () => {
      expect(parseJwt({ issuer: { iss: 'did:key:nested' } }).issuer.id).toBe('did:key:nested');
    });

    it('yields an empty id when an object issuer has neither id nor iss', () => {
      expect(parseJwt({ issuer: { organization: 'Orphan' } }).issuer.id).toBe('');
    });

    it('yields an empty id when the issuer is missing or not an object', () => {
      expect(parseJwt({}).issuer).toEqual({ id: '' });
      expect(parseJwt({ issuer: 99 }).issuer).toEqual({ id: '' });
      expect(parseJwt({ issuer: null }).issuer).toEqual({ id: '' });
    });
  });

  describe('validity window extraction', () => {
    it('prefers validFrom and validUntil', () => {
      const result = parseJwt({
        validFrom: '2026-03-01T00:00:00Z',
        validUntil: '2026-09-01T00:00:00Z',
        issuanceDate: '2020-01-01T00:00:00Z',
        expirationDate: '2021-01-01T00:00:00Z',
      });

      expect(result.validFrom).toBe('2026-03-01T00:00:00Z');
      expect(result.validUntil).toBe('2026-09-01T00:00:00Z');
    });

    it('falls back to the W3C v1 issuanceDate and expirationDate', () => {
      const result = parseJwt({
        issuanceDate: '2026-02-01T00:00:00Z',
        expirationDate: '2026-08-01T00:00:00Z',
      });

      expect(result.validFrom).toBe('2026-02-01T00:00:00Z');
      expect(result.validUntil).toBe('2026-08-01T00:00:00Z');
    });

    it('converts the iat and exp epoch-second claims to ISO instants', () => {
      const result = parseJwt({ iat: 1767225600, exp: 1798761600 });

      expect(result.validFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(result.validUntil).toBe('2027-01-01T00:00:00.000Z');
    });

    it('defaults validFrom to now and leaves validUntil empty when nothing is present', () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T10:30:00.000Z'));

      const result = parseJwt({});

      expect(result.validFrom).toBe('2026-06-15T10:30:00.000Z');
      expect(result.validUntil).toBe('');
    });
  });

  describe('SD-JWT credentials', () => {
    it('builds the credential subject from the disclosed non-standard claims', () => {
      const result = parseSdJwt({
        iss: 'did:key:issuer',
        iat: 1767225600,
        exp: 1798761600,
        vct: 'urn:es.cgcom:doctorid:1',
        cnf: { jwk: {} },
        collegiateNumber: '282812345',
        givenName: 'Ada',
      });

      expect(result.credentialSubject).toEqual({
        collegiateNumber: '282812345',
        givenName: 'Ada',
      });
    });

    it('prefers an explicit credentialSubject over the disclosed claims', () => {
      const result = parseSdJwt({
        vct: 'urn:es.cgcom:doctorid:1',
        credentialSubject: { id: 'did:key:subject' },
        strayClaim: 'ignored',
      });

      expect(result.credentialSubject).toEqual({ id: 'did:key:subject' });
    });

    it('derives the type from the vct claim', () => {
      expect(parseSdJwt({ vct: 'urn:es.cgcom:doctorid:1' }).type).toEqual([
        'VerifiableCredential',
        'urn:es.cgcom:doctorid:1',
      ]);
    });

    it('defaults the type to VerifiableCredential without type or vct', () => {
      expect(parseSdJwt({ iss: 'did:key:issuer' }).type).toEqual(['VerifiableCredential']);
    });

    it('prefers an explicit type array over the vct claim', () => {
      expect(
        parseSdJwt({ vct: 'urn:es.cgcom:doctorid:1', type: ['VerifiableCredential'] }).type
      ).toEqual(['VerifiableCredential']);
    });

    it('takes the identifier from jti, then id, then a minted uuid', () => {
      expect(parseSdJwt({ jti: 'urn:uuid:from-jti', id: 'urn:uuid:from-id' }).id).toBe(
        'urn:uuid:from-jti'
      );
      expect(parseSdJwt({ id: 'urn:uuid:from-id' }).id).toBe('urn:uuid:from-id');
      expect(parseSdJwt({}).id).toBe('urn:uuid:' + FIXED_UUID);
    });

    it('defaults the context to an empty array when the claim is absent', () => {
      expect(parseSdJwt({ vct: 'urn:es.cgcom:doctorid:1' })['@context']).toEqual([]);
    });

    it('keeps an explicit context', () => {
      expect(
        parseSdJwt({ '@context': ['https://www.w3.org/ns/credentials/v2'] })['@context']
      ).toEqual(['https://www.w3.org/ns/credentials/v2']);
    });

    it('records the compact SD-JWT as the encoded credential', () => {
      const result = parseSdJwt({ vct: 'urn:es.cgcom:doctorid:1' });

      expect(result.credentialEncoded).toBe('compact~sd~jwt');
      expect(result.credentialFormat).toBe('dc+sd-jwt');
    });

    it('maps a Token Status List entry into a credentialStatus', () => {
      const result = parseSdJwt({
        vct: 'urn:es.cgcom:doctorid:1',
        status: { status_list: { uri: 'https://issuer.example/statuslists/1', idx: 42 } },
      });

      expect(result.credentialStatus).toEqual({
        id: 'https://issuer.example/statuslists/1#42',
        type: 'TokenStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '42',
        statusListCredential: 'https://issuer.example/statuslists/1',
      });
    });

    it('prefers an explicit credentialStatus over the status claim', () => {
      const result = parseSdJwt({
        credentialStatus: { id: 'explicit', type: 'BitstringStatusListEntry' },
        status: { status_list: { uri: 'https://issuer.example/statuslists/1', idx: 42 } },
      });

      expect(result.credentialStatus).toEqual({
        id: 'explicit',
        type: 'BitstringStatusListEntry',
      });
    });

    it('falls back to an empty credentialStatus when the status list has no uri', () => {
      expect(parseSdJwt({ status: { status_list: { idx: 7 } } }).credentialStatus).toEqual(
        EMPTY_STATUS
      );
      expect(parseSdJwt({ status: {} }).credentialStatus).toEqual(EMPTY_STATUS);
      expect(parseSdJwt({}).credentialStatus).toEqual(EMPTY_STATUS);
    });

    it('resolves the issuer and validity window from the SD-JWT claims', () => {
      const result = parseSdJwt({
        iss: 'did:key:sd-issuer',
        iat: 1767225600,
        exp: 1798761600,
      });

      expect(result.issuer).toEqual({ id: 'did:key:sd-issuer' });
      expect(result.validFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(result.validUntil).toBe('2027-01-01T00:00:00.000Z');
    });
  });
});
