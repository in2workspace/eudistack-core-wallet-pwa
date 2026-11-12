import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UrlResolverService } from 'src/app/core/services/url-resolver.service';
import { PrfSaltApi, PrfSaltDto } from './prf-salt.api';

const BASE = 'https://wallet.example';
const SALT: PrfSaltDto = {
  credential_id: 'holder-1',
  prf_salt: 'c2FsdA',
  kdf: { algorithm: 'HKDF-SHA-256', info: 'eudistack:passkey-prf:p256:v1' },
};

describe('PrfSaltApi', () => {
  let api: PrfSaltApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => BASE } },
      ],
    });
    api = TestBed.inject(PrfSaltApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('create posts the credential id to the salts collection and returns the salt', async () => {
    // Arrange
    const result = api.create('holder-1');

    // Act
    const req = http.expectOne(`${BASE}/api/v1/keys/passkey-prf/salts`);
    req.flush(SALT, { status: 201, statusText: 'Created' });

    // Assert
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ credential_id: 'holder-1' });
    await expect(result).resolves.toEqual(SALT);
  });

  it('get reads the salt and public key of the attestation', async () => {
    // Arrange
    const withKey: PrfSaltDto = { ...SALT, public_jwk: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' } };
    const result = api.get('holder-1');

    // Act
    const req = http.expectOne(`${BASE}/api/v1/keys/passkey-prf/salts/holder-1`);
    req.flush(withKey);

    // Assert
    expect(req.request.method).toBe('GET');
    await expect(result).resolves.toEqual(withKey);
  });

  it('get encodes the credential id in the path', async () => {
    // Arrange
    const result = api.get('holder/1 a');

    // Act
    const req = http.expectOne(`${BASE}/api/v1/keys/passkey-prf/salts/holder%2F1%20a`);
    req.flush(SALT);

    // Assert
    await expect(result).resolves.toEqual(SALT);
  });

  it('get rejects when the service answers 404 (other passkey or unknown attestation)', async () => {
    // Arrange
    const result = api.get('holder-1');

    // Act
    http.expectOne(`${BASE}/api/v1/keys/passkey-prf/salts/holder-1`).flush({}, { status: 404, statusText: 'Not Found' });

    // Assert
    await expect(result).rejects.toMatchObject({ status: 404 });
  });
});
