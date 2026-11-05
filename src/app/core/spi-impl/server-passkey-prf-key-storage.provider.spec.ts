/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { ServerPasskeyPrfKeyStorageProvider } from './server-passkey-prf-key-storage.provider';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { PasskeyPrfAdapterError } from '../models/error/PasskeyPrfAdapterError';
import { KeyInfo } from '../models/StoredKeyRecord';
import { OID4VCIKeyGenContext } from '../spi/key-storage.provider.service';
import { JWT_PROOF_CLAIM } from '../constants/jwt.constants';
import { base64UrlDecode, base64UrlEncode } from '../utils/base64url';
import { PrfSaltApi, PrfSaltDto } from 'src/app/features/passkey-prf-keymanager/prf-salt.api';
import { PasskeyPrfHolderKeyService } from 'src/app/features/passkey-prf-keymanager/passkey-prf-holder-key.service';

// JSDOM does not implement crypto.subtle; polyfill with Node's built-in WebCrypto API
// (the provider signs with a real key and computes real JWK thumbprints).
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const SALT_BYTES = new Uint8Array(32).fill(7);
const KDF_INFO = 'eudistack:passkey-prf:p256:v1';
const CONTEXT: OID4VCIKeyGenContext = {
  credentialId: 'holder-1',
  format: 'dc+sd-jwt',
  supportedAlgs: ['ES256'],
  issuerIdentifier: 'https://issuer.example',
  cNonce: 'nonce-1',
};
const KEY_INFO: KeyInfo[] = [{ keyId: 'k1', algorithm: 'ES256', createdAt: '2026-01-01T00:00:00Z' }];

interface TestKey {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
}

async function generateTestKey(): Promise<TestKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
  };
}

function saltDto(publicJwk?: JsonWebKey): PrfSaltDto {
  return {
    credential_id: CONTEXT.credentialId,
    prf_salt: base64UrlEncode(SALT_BYTES),
    kdf: { algorithm: 'HKDF-SHA-256', info: KDF_INFO },
    public_jwk: publicJwk,
  };
}

function buildServerMock(): jest.Mocked<ServerKeyStorageProvider> {
  return {
    generateKeyPair: jest.fn(),
    hasKey: jest.fn().mockResolvedValue(true),
    deleteKey: jest.fn().mockResolvedValue(undefined),
    listKeys: jest.fn().mockResolvedValue(KEY_INFO),
    isCnfBoundToPublicKey: jest.fn().mockResolvedValue(true),
    resolveKeyIdByKid: jest.fn().mockResolvedValue(null),
    buildPresentationJws: jest.fn(),
    sign: jest.fn(),
  } as unknown as jest.Mocked<ServerKeyStorageProvider>;
}

function setup(): {
  provider: ServerPasskeyPrfKeyStorageProvider;
  server: jest.Mocked<ServerKeyStorageProvider>;
  saltApi: { create: jest.Mock; get: jest.Mock };
  holderKey: { derive: jest.Mock };
} {
  const server = buildServerMock();
  const saltApi = { create: jest.fn(), get: jest.fn() };
  const holderKey = { derive: jest.fn() };
  TestBed.configureTestingModule({
    providers: [
      ServerPasskeyPrfKeyStorageProvider,
      { provide: ServerKeyStorageProvider, useValue: server },
      { provide: PrfSaltApi, useValue: saltApi },
      { provide: PasskeyPrfHolderKeyService, useValue: holderKey },
    ],
  });
  return { provider: TestBed.inject(ServerPasskeyPrfKeyStorageProvider), server, saltApi, holderKey };
}

describe('ServerPasskeyPrfKeyStorageProvider', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('generateKeyPair', () => {
    it('asks for the salt of the new attestation, derives its key and returns the proof signed with it', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const key = await generateTestKey();
      saltApi.create.mockResolvedValue(saltDto());
      holderKey.derive.mockResolvedValue({ privateKey: key.privateKey, publicKeyJwk: key.publicKeyJwk });

      // Act
      const info = await provider.generateKeyPair('ES256', 'ignored', CONTEXT);

      // Assert
      expect(saltApi.create).toHaveBeenCalledWith('holder-1');
      expect(holderKey.derive).toHaveBeenCalledWith(SALT_BYTES, KDF_INFO);
      expect(info.keyId).toBe('holder-1');
      expect(info.algorithm).toBe('ES256');
      expect(info.publicKeyJwk).toEqual(key.publicKeyJwk);
      expect(info.kid).toBe(await provider.computeJwkThumbprint(key.publicKeyJwk));
      const [header, payload, signature] = (info.prebuiltJwsProof as string).split('.');
      expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(header)))).toMatchObject({
        alg: 'ES256',
        typ: JWT_PROOF_CLAIM,
        jwk: key.publicKeyJwk,
      });
      expect(JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)))).toMatchObject({
        aud: ['https://issuer.example'],
        nonce: 'nonce-1',
      });
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key.publicKey,
        base64UrlDecode(signature).slice(),
        new TextEncoder().encode(`${header}.${payload}`)
      );
      expect(valid).toBe(true);
    });

    it('uses a single derivation for the whole issuance (one use of the passkey)', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const key = await generateTestKey();
      saltApi.create.mockResolvedValue(saltDto());
      holderKey.derive.mockResolvedValue({ privateKey: key.privateKey, publicKeyJwk: key.publicKeyJwk });

      // Act
      await provider.generateKeyPair('ES256', 'ignored', CONTEXT);

      // Assert
      expect(holderKey.derive).toHaveBeenCalledTimes(1);
    });

    it('rejects without an issuance context', async () => {
      // Arrange
      const { provider, saltApi } = setup();

      // Act + Assert
      await expect(provider.generateKeyPair('ES256', 'k')).rejects.toBeInstanceOf(PasskeyPrfAdapterError);
      expect(saltApi.create).not.toHaveBeenCalled();
    });

    it('propagates a failed derivation (e.g. the user cancelled the passkey) and returns no proof', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      saltApi.create.mockResolvedValue(saltDto());
      holderKey.derive.mockRejectedValue(new Error('cancelled'));

      // Act + Assert
      await expect(provider.generateKeyPair('ES256', 'k', CONTEXT)).rejects.toThrow('cancelled');
    });

    it('propagates a failed salt request without using the passkey', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      saltApi.create.mockRejectedValue(new Error('404'));

      // Act + Assert
      await expect(provider.generateKeyPair('ES256', 'k', CONTEXT)).rejects.toThrow('404');
      expect(holderKey.derive).not.toHaveBeenCalled();
    });
  });

  describe('sign', () => {
    it('derives the key of the attestation and signs the data with it', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const key = await generateTestKey();
      saltApi.get.mockResolvedValue(saltDto(key.publicKeyJwk));
      holderKey.derive.mockResolvedValue({ privateKey: key.privateKey, publicKeyJwk: key.publicKeyJwk });
      const data = new TextEncoder().encode('header.payload');

      // Act
      const signature = await provider.sign('holder-1', data);

      // Assert
      expect(saltApi.get).toHaveBeenCalledWith('holder-1');
      expect(holderKey.derive).toHaveBeenCalledWith(SALT_BYTES, KDF_INFO);
      expect(signature).toHaveLength(64);
      const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key.publicKey, signature.slice(), data);
      expect(valid).toBe(true);
    });

    it('uses the passkey on every signature: two signatures derive twice', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const key = await generateTestKey();
      saltApi.get.mockResolvedValue(saltDto(key.publicKeyJwk));
      holderKey.derive.mockResolvedValue({ privateKey: key.privateKey, publicKeyJwk: key.publicKeyJwk });

      // Act
      await provider.sign('holder-1', new Uint8Array([1]));
      await provider.sign('holder-1', new Uint8Array([2]));

      // Assert
      expect(holderKey.derive).toHaveBeenCalledTimes(2);
      expect(saltApi.get).toHaveBeenCalledTimes(2);
    });

    it('does not sign when the derived public key is not the stored one', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const derived = await generateTestKey();
      const stored = await generateTestKey();
      saltApi.get.mockResolvedValue(saltDto(stored.publicKeyJwk));
      holderKey.derive.mockResolvedValue({ privateKey: derived.privateKey, publicKeyJwk: derived.publicKeyJwk });
      const signSpy = jest.spyOn(crypto.subtle, 'sign');

      // Act
      const result = provider.sign('holder-1', new Uint8Array([1]));

      // Assert
      await expect(result).rejects.toMatchObject({
        code: 'key_mismatch',
        translationKey: 'errors.passkey-key-mismatch',
      });
      expect(signSpy).not.toHaveBeenCalled();
    });

    it('does not sign when the service has no public key for the attestation', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      const derived = await generateTestKey();
      saltApi.get.mockResolvedValue(saltDto(undefined));
      holderKey.derive.mockResolvedValue({ privateKey: derived.privateKey, publicKeyJwk: derived.publicKeyJwk });

      // Act + Assert
      await expect(provider.sign('holder-1', new Uint8Array([1]))).rejects.toMatchObject({ code: 'key_mismatch' });
    });

    it('does not use the passkey when the service does not give the salt (404)', async () => {
      // Arrange
      const { provider, saltApi, holderKey } = setup();
      saltApi.get.mockRejectedValue(new Error('404'));

      // Act + Assert
      await expect(provider.sign('holder-1', new Uint8Array([1]))).rejects.toThrow('404');
      expect(holderKey.derive).not.toHaveBeenCalled();
    });
  });

  describe('operations delegated to the server provider', () => {
    it('hasKey, deleteKey and listKeys', async () => {
      // Arrange
      const { provider, server } = setup();

      // Act + Assert
      await expect(provider.hasKey('k1')).resolves.toBe(true);
      await expect(provider.deleteKey()).resolves.toBeUndefined();
      await expect(provider.listKeys()).resolves.toEqual(KEY_INFO);
      expect(server.hasKey).toHaveBeenCalledWith('k1');
      expect(server.deleteKey).toHaveBeenCalled();
    });

    it('isCnfBoundToPublicKey and resolveKeyIdByKid', async () => {
      // Arrange
      const { provider, server } = setup();
      const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' };

      // Act + Assert
      await expect(provider.isCnfBoundToPublicKey({ jwk }, jwk)).resolves.toBe(true);
      await expect(provider.resolveKeyIdByKid()).resolves.toBeNull();
      expect(server.isCnfBoundToPublicKey).toHaveBeenCalledWith({ jwk }, jwk);
      expect(server.resolveKeyIdByKid).toHaveBeenCalled();
    });

    it('does not offer a presentation signed by the service nor key export or import', () => {
      // Arrange
      const { provider } = setup();

      // Act + Assert
      expect((provider as unknown as Record<string, unknown>)['buildPresentationJws']).toBeUndefined();
      expect((provider as unknown as Record<string, unknown>)['exportKey']).toBeUndefined();
      expect((provider as unknown as Record<string, unknown>)['importKey']).toBeUndefined();
    });
  });
});
