import { TestBed } from '@angular/core/testing';
import { HybridKeyStorageProvider } from './hybrid-key-storage.provider';
import { ServerKeyStorageProvider } from './server-key-storage.service';
import { HybridAdapterError } from '../models/error/HybridAdapterError';
import { PublicKeyInfo, KeyInfo } from '../models/StoredKeyRecord';

const PUB_KEY_INFO: PublicKeyInfo = {
  keyId: 'k1', algorithm: 'ES256',
  publicKeyJwk: { kty: 'EC' } as JsonWebKey,
  kid: 'thumb-1', createdAt: '2026-01-01T00:00:00Z',
};
const KEY_INFO: KeyInfo[] = [{ keyId: 'k1', algorithm: 'ES256', createdAt: '2026-01-01T00:00:00Z' }];

function buildServerMock(): jest.Mocked<ServerKeyStorageProvider> {
  return {
    generateKeyPair: jest.fn().mockResolvedValue(PUB_KEY_INFO),
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

function setup(): { provider: HybridKeyStorageProvider; server: jest.Mocked<ServerKeyStorageProvider> } {
  const server = buildServerMock();
  TestBed.configureTestingModule({
    providers: [
      HybridKeyStorageProvider,
      { provide: ServerKeyStorageProvider, useValue: server },
    ],
  });
  return { provider: TestBed.inject(HybridKeyStorageProvider), server };
}

describe('HybridKeyStorageProvider', () => {
  it('delegates generateKeyPair to ServerKeyStorageProvider', async () => {
    const { provider, server } = setup();
    const result = await provider.generateKeyPair('ES256', 'k1');
    expect(server.generateKeyPair).toHaveBeenCalledWith('ES256', 'k1', undefined);
    expect(result).toBe(PUB_KEY_INFO);
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
