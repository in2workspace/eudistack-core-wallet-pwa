/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { HybridKeyStorageProvider } from './hybrid-key-storage.provider';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { HybridAdapterError } from '../models/error/HybridAdapterError';
import { AppError } from '../models/error/AppError';
import { KeyInfo } from '../models/StoredKeyRecord';
import { HybridKeyEnrollmentService, HybridEnrollmentResult } from 'src/app/features/hybrid-keymanager/hybrid-key-enrollment.service';
import { OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';

// JSDOM does not implement crypto.subtle; polyfill with Node's built-in WebCrypto API
// (generateKeyPair() computes a real JWK thumbprint via computeJwkThumbprint()).
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const PUBLIC_KEY_JWK: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };
const ENROLLMENT_RESULT: HybridEnrollmentResult = {
  publicKeyJwk: PUBLIC_KEY_JWK,
  jwsProof: 'header.payload.sig',
};
const CONTEXT: OID4VCIKeyGenContext = {
  credentialId: 'cred-1',
  format: 'vc+sd-jwt',
  supportedAlgs: ['ES256'],
  issuerIdentifier: 'https://issuer.example',
  cNonce: 'nonce-1',
};
const KEY_INFO: KeyInfo[] = [{ keyId: 'k1', algorithm: 'ES256', createdAt: '2026-01-01T00:00:00Z' }];

function buildServerMock(): jest.Mocked<ServerKeyStorageProvider> {
  return {
    generateKeyPair: jest.fn(),
    hasKey: jest.fn().mockResolvedValue(true),
    deleteKey: jest.fn().mockResolvedValue(undefined),
    listKeys: jest.fn().mockResolvedValue(KEY_INFO),
    isCnfBoundToPublicKey: jest.fn().mockResolvedValue(true),
    resolveKeyIdByKid: jest.fn().mockResolvedValue('k1'),
    exportKey: jest.fn().mockResolvedValue({ kty: 'EC' } as JsonWebKey),
    importKey: jest.fn().mockResolvedValue(undefined),
    buildPresentationJws: jest.fn(),
    sign: jest.fn(),
  } as unknown as jest.Mocked<ServerKeyStorageProvider>;
}

function buildEnrollmentMock(): jest.Mocked<HybridKeyEnrollmentService> {
  return {
    enroll: jest.fn().mockResolvedValue(ENROLLMENT_RESULT),
  } as unknown as jest.Mocked<HybridKeyEnrollmentService>;
}

function setup(): {
  provider: HybridKeyStorageProvider;
  server: jest.Mocked<ServerKeyStorageProvider>;
  enrollment: jest.Mocked<HybridKeyEnrollmentService>;
} {
  const server = buildServerMock();
  const enrollment = buildEnrollmentMock();
  TestBed.configureTestingModule({
    providers: [
      HybridKeyStorageProvider,
      { provide: ServerKeyStorageProvider, useValue: server },
      { provide: HybridKeyEnrollmentService, useValue: enrollment },
    ],
  });
  return { provider: TestBed.inject(HybridKeyStorageProvider), server, enrollment };
}

describe('HybridKeyStorageProvider', () => {
  it('generateKeyPair() delegates to HybridKeyEnrollmentService and returns the prebuilt OID4VCI proof', async () => {
    const { provider, server, enrollment } = setup();
    const result = await provider.generateKeyPair('ES256', 'k1', CONTEXT);

    expect(enrollment.enroll).toHaveBeenCalledWith(CONTEXT);
    expect(server.generateKeyPair).not.toHaveBeenCalled();
    expect(result.publicKeyJwk).toBe(PUBLIC_KEY_JWK);
    expect(result.prebuiltJwsProof).toBe('header.payload.sig');
    expect(result.kid).toEqual(expect.any(String));
  });

  it('generateKeyPair() returns a fresh opaque UUID, not the caller-supplied keyId', async () => {
    // The engine's keyId (`credentialIssuer:credentialConfigurationId`) does not fit
    // wallet_credential.holder_key_id VARCHAR(36) — see PostgresqlBadGrammarException
    // 22001 regression. Hybrid has no server-side holder_key row to reference anyway.
    const { provider } = setup();
    const result = await provider.generateKeyPair('ES256', 'k1', CONTEXT);

    expect(result.keyId).not.toBe('k1');
    expect(result.keyId.length).toBeLessThanOrEqual(36);
    expect(result.keyId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('generateKeyPair() rejects with AppError when called without an OID4VCI context', async () => {
    const { provider, enrollment } = setup();

    await expect(provider.generateKeyPair('ES256', 'k1')).rejects.toBeInstanceOf(AppError);
    expect(enrollment.enroll).not.toHaveBeenCalled();
  });

  it('sign() throws HybridAdapterError with code prepare_sign_failed', async () => {
    const { provider } = setup();
    await expect(provider.sign('k1', new Uint8Array([1, 2, 3])))
      .rejects.toBeInstanceOf(HybridAdapterError);

    await provider.sign('k1', new Uint8Array()).catch((e: HybridAdapterError) => {
      expect(e.code).toBe('prepare_sign_failed');
    });
  });

  it('buildPresentationJws() rejects with HybridAdapterError code prepare_sign_failed', async () => {
    const { provider } = setup();
    await expect(provider.buildPresentationJws!('k1', {}, 'KB_JWT'))
      .rejects.toBeInstanceOf(HybridAdapterError);
  });

  it('delegates hasKey to server', async () => {
    const { provider, server } = setup();
    await provider.hasKey('k1');
    expect(server.hasKey).toHaveBeenCalledWith('k1');
  });

  it('delegates deleteKey to server', async () => {
    const { provider, server } = setup();
    await provider.deleteKey('k1');
    expect(server.deleteKey).toHaveBeenCalledWith('k1');
  });

  it('delegates listKeys to server', async () => {
    const { provider, server } = setup();
    const result = await provider.listKeys();
    expect(result).toBe(KEY_INFO);
  });

  it('delegates isCnfBoundToPublicKey to server', async () => {
    const { provider, server } = setup();
    await provider.isCnfBoundToPublicKey({}, { kty: 'EC' });
    expect(server.isCnfBoundToPublicKey).toHaveBeenCalled();
  });

  it('delegates resolveKeyIdByKid to server', async () => {
    const { provider, server } = setup();
    const result = await provider.resolveKeyIdByKid('k1');
    expect(server.resolveKeyIdByKid).toHaveBeenCalledWith('k1');
    expect(result).toBe('k1');
  });
});
