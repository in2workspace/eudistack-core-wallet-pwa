/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UrlResolverService } from '../services/url-resolver.service';
import { ServerKeyStorageProvider } from './server-key-storage.service';

// JSDOM does not implement crypto.subtle; polyfill with Node's built-in WebCrypto API
// (isCnfBoundToPublicKey() computes real JWK thumbprints).
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const BASE = 'https://wallet.example';

describe('ServerKeyStorageProvider', () => {
  let provider: ServerKeyStorageProvider;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ServerKeyStorageProvider,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: UrlResolverService, useValue: { serverUrl: () => BASE } },
      ],
    });
    provider = TestBed.inject(ServerKeyStorageProvider);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listKeys returns the holder key of every attestation that has one', async () => {
    // Arrange
    const result = provider.listKeys();

    // Act
    http.expectOne(`${BASE}/api/v1/credentials`).flush([
      { id: 'c1', holder_key_id: 'k1' },
      { id: 'c2' },
    ]);

    // Assert
    await expect(result).resolves.toEqual([{ keyId: 'k1', algorithm: 'ES256', createdAt: '' }]);
  });

  it('hasKey looks the key up in the list of attestations, not in a key endpoint', async () => {
    // Arrange
    const result = provider.hasKey('k1');

    // Act
    http.expectOne(`${BASE}/api/v1/credentials`).flush([{ id: 'c1', holder_key_id: 'k1' }]);

    // Assert
    await expect(result).resolves.toBe(true);
  });

  it('hasKey is false for a key no attestation has', async () => {
    // Arrange
    const result = provider.hasKey('other');

    // Act
    http.expectOne(`${BASE}/api/v1/credentials`).flush([{ id: 'c1', holder_key_id: 'k1' }]);

    // Assert
    await expect(result).resolves.toBe(false);
  });

  it('deleteKey makes no request: the service deletes the key with its attestation', async () => {
    // Arrange
    // no pending expectations: http.verify() fails on any request

    // Act
    const result = provider.deleteKey();

    // Assert
    await expect(result).resolves.toBeUndefined();
  });

  it('resolveKeyIdByKid makes no request and finds nothing: the key comes from the chosen attestation', async () => {
    // Arrange
    // no pending expectations: http.verify() fails on any request

    // Act
    const result = provider.resolveKeyIdByKid();

    // Assert
    await expect(result).resolves.toBeNull();
  });

  it('does not offer key export or import', () => {
    // Arrange
    const anyProvider = provider as unknown as Record<string, unknown>;

    // Act + Assert
    expect(anyProvider['exportKey']).toBeUndefined();
    expect(anyProvider['importKey']).toBeUndefined();
  });

  it('isCnfBoundToPublicKey compares the thumbprints of the cnf key and the proof key', async () => {
    // Arrange
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'x1', y: 'y1' };
    const other: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'x2', y: 'y2' };

    // Act + Assert
    await expect(provider.isCnfBoundToPublicKey({ jwk }, jwk)).resolves.toBe(true);
    await expect(provider.isCnfBoundToPublicKey({ jwk: other }, jwk)).resolves.toBe(false);
    await expect(provider.isCnfBoundToPublicKey(undefined, jwk)).resolves.toBe(false);
  });
});
