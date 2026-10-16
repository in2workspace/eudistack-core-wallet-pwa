import { TestBed } from '@angular/core/testing';
import { CredentialPreviewBuilderService } from './credential-preview-builder.service';
import { JwtService } from '../protocol/oid4vci/jwt.service';
import { SdJwtParserService } from '../protocol/oid4vci/sd-jwt-parser.service';
import { CredentialDisplayService } from './credential-display.service';
import { CredentialResponse } from '../models/dto/CredentialResponse';
import { CredentialMetadata } from '../models/dto/CredentialIssuerMetadata';

const EMPTY_PREVIEW = {
  displayName: '',
  format: '',
  fields: [],
  sections: [],
  expirationDate: '',
};

const metadata = (): CredentialMetadata => ({
  display: [{ name: 'Carné colegial', locale: 'es-ES' }],
  claims: [],
});

const responseWith = (credential: string): CredentialResponse => ({
  credentials: [{ credential }],
});

describe('CredentialPreviewBuilderService', () => {
  let service: CredentialPreviewBuilderService;
  let extractJwtPayload: jest.Mock;
  let isSdJwt: jest.Mock;
  let reconstructClaims: jest.Mock;
  let buildFieldsFromClaims: jest.Mock;
  let createSectionsFromClaims: jest.Mock;

  beforeEach(() => {
    extractJwtPayload = jest.fn();
    isSdJwt = jest.fn().mockReturnValue(false);
    reconstructClaims = jest.fn();
    buildFieldsFromClaims = jest.fn().mockReturnValue([{ label: 'Nombre', value: 'Ada' }]);
    createSectionsFromClaims = jest.fn().mockReturnValue([{ section: 'Datos', fields: [] }]);

    TestBed.configureTestingModule({
      providers: [
        CredentialPreviewBuilderService,
        { provide: JwtService, useValue: { extractJwtPayload } },
        { provide: SdJwtParserService, useValue: { isSdJwt, reconstructClaims } },
        {
          provide: CredentialDisplayService,
          useValue: { buildFieldsFromClaims, createSectionsFromClaims },
        },
      ],
    });

    service = TestBed.inject(CredentialPreviewBuilderService);
  });

  it('returns an empty preview when the response carries no credential', () => {
    expect(service.buildPreview({})).toEqual(EMPTY_PREVIEW);
    expect(service.buildPreview({ credentials: [] })).toEqual(EMPTY_PREVIEW);
  });

  it('builds the preview of a JWT-VC from the issuer metadata', () => {
    extractJwtPayload.mockReturnValue({
      vc: {
        credentialSubject: { givenName: 'Ada' },
        validUntil: '2027-01-01T00:00:00.000Z',
      },
    });

    const preview = service.buildPreview(responseWith('a.b.c'), metadata(), 'jwt_vc_json');

    expect(preview).toEqual({
      displayName: 'Carné colegial',
      format: 'JWT',
      fields: [{ label: 'Nombre', value: 'Ada' }],
      sections: [{ section: 'Datos', fields: [] }],
      expirationDate: '2027-01-01T00:00:00.000Z',
    });
    expect(buildFieldsFromClaims).toHaveBeenCalledWith({ givenName: 'Ada' }, expect.anything());
  });

  it('reads a flat JWT payload when there is no vc wrapper', () => {
    extractJwtPayload.mockReturnValue({
      credentialSubject: { givenName: 'Ada' },
      expirationDate: '2026-06-01T00:00:00.000Z',
    });

    const preview = service.buildPreview(responseWith('a.b.c'), metadata(), 'jwt_vc_json');

    expect(preview.expirationDate).toBe('2026-06-01T00:00:00.000Z');
  });

  it('leaves fields and sections empty when the issuer advertises no metadata', () => {
    extractJwtPayload.mockReturnValue({ vc: { credentialSubject: { givenName: 'Ada' } } });

    const preview = service.buildPreview(responseWith('a.b.c'), undefined, 'dc+sd-jwt');

    expect(preview).toEqual({
      displayName: '',
      format: 'SD-JWT',
      fields: [],
      sections: [],
      expirationDate: '',
    });
    expect(buildFieldsFromClaims).not.toHaveBeenCalled();
    expect(createSectionsFromClaims).not.toHaveBeenCalled();
  });

  it('derives the subject from the disclosed claims of an SD-JWT and converts exp to an instant', () => {
    isSdJwt.mockReturnValue(true);
    reconstructClaims.mockReturnValue({
      payload: {
        iss: 'https://issuer.example',
        iat: 1767225600,
        exp: 1798761600,
        vct: 'urn:es.cgcom:doctorid:1',
        collegiateNumber: '282812345',
      },
      issuerJwt: 'issuer-jwt',
    });

    const preview = service.buildPreview(responseWith('issuer~disc~'), metadata(), 'dc+sd-jwt');

    expect(preview.format).toBe('SD-JWT');
    expect(preview.expirationDate).toBe('2027-01-01T00:00:00.000Z');
    expect(buildFieldsFromClaims).toHaveBeenCalledWith(
      { collegiateNumber: '282812345' },
      expect.anything()
    );
  });

  it('maps the protocol format to a human label, passing anything unknown through', () => {
    extractJwtPayload.mockReturnValue({ vc: {} });
    const build = (format?: string) =>
      service.buildPreview(responseWith('a.b.c'), metadata(), format).format;

    expect(build('dc+sd-jwt')).toBe('SD-JWT');
    expect(build('jwt_vc_json')).toBe('JWT');
    expect(build('mso_mdoc')).toBe('mso_mdoc');
    expect(build(undefined)).toBe('');
  });
});
