/// <reference types="node" />
import { TestBed } from '@angular/core/testing';
import { deriveP256KeyFromBytes } from 'src/app/core/utils/p256-key-derivation.util';
import { PASSKEY_PRF_HKDF_INFO, PASSKEY_PRF_HKDF_SALT } from './passkey-prf-kdf.const';
import { PasskeyPrfHolderKeyService } from './passkey-prf-holder-key.service';
import { PrfClientService } from './prf-client.service';

// JSDOM does not implement crypto.subtle; polyfill with Node's built-in WebCrypto API.
if (!globalThis.crypto?.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto') as { webcrypto: Crypto };
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}

const SALT = new Uint8Array(32).fill(1);

function setup(prfOutput: Uint8Array | Error): { service: PasskeyPrfHolderKeyService; prfClient: { evaluate: jest.Mock } } {
  const prfClient = {
    evaluate: prfOutput instanceof Error ? jest.fn().mockRejectedValue(prfOutput) : jest.fn().mockResolvedValue(prfOutput),
  };
  TestBed.configureTestingModule({
    providers: [PasskeyPrfHolderKeyService, { provide: PrfClientService, useValue: prfClient }],
  });
  return { service: TestBed.inject(PasskeyPrfHolderKeyService), prfClient };
}

describe('PasskeyPrfHolderKeyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses the passkey once with the salt of the attestation', async () => {
    // Arrange
    const { service, prfClient } = setup(new Uint8Array(32).fill(5));

    // Act
    await service.derive(SALT);

    // Assert
    expect(prfClient.evaluate).toHaveBeenCalledTimes(1);
    expect(prfClient.evaluate).toHaveBeenCalledWith(SALT);
  });

  it('derives the key with HKDF without salt and the info of the service', async () => {
    // Arrange
    const { service } = setup(new Uint8Array(32).fill(5));
    const expected = await deriveP256KeyFromBytes(new Uint8Array(32).fill(5), PASSKEY_PRF_HKDF_SALT, PASSKEY_PRF_HKDF_INFO);

    // Act
    const derived = await service.derive(SALT);

    // Assert
    expect(derived.publicKeyJwk).toEqual(expected.publicKeyJwk);
    expect(derived.privateKey.extractable).toBe(false);
  });

  it('uses the info the service sends when it is not the default one', async () => {
    // Arrange
    const { service } = setup(new Uint8Array(32).fill(5));
    const expected = await deriveP256KeyFromBytes(new Uint8Array(32).fill(5), PASSKEY_PRF_HKDF_SALT, 'eudistack:passkey-prf:p256:v2');

    // Act
    const derived = await service.derive(SALT, 'eudistack:passkey-prf:p256:v2');

    // Assert
    expect(derived.publicKeyJwk).toEqual(expected.publicKeyJwk);
  });

  it('zero-fills the PRF output after deriving the key', async () => {
    // Arrange
    const prfOutput = new Uint8Array(32).fill(5);
    const { service } = setup(prfOutput);

    // Act
    await service.derive(SALT);

    // Assert
    expect(Array.from(prfOutput)).toEqual(new Array(32).fill(0));
  });

  it('zero-fills the PRF output even when the derivation fails', async () => {
    // Arrange
    const prfOutput = new Uint8Array(32).fill(5);
    const { service } = setup(prfOutput);
    jest.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('crypto down'));

    // Act
    const result = service.derive(SALT);

    // Assert
    await expect(result).rejects.toThrow('crypto down');
    expect(Array.from(prfOutput)).toEqual(new Array(32).fill(0));
  });

  it('does not derive anything when the user does not use the passkey', async () => {
    // Arrange
    const { service } = setup(new Error('cancelled'));
    const deriveBits = jest.spyOn(crypto.subtle, 'deriveBits');

    // Act
    const result = service.derive(SALT);

    // Assert
    await expect(result).rejects.toThrow('cancelled');
    expect(deriveBits).not.toHaveBeenCalled();
  });

  it('derives a different key for each use only if the PRF output differs (no cache)', async () => {
    // Arrange
    const { service, prfClient } = setup(new Uint8Array(32).fill(5));
    prfClient.evaluate
      .mockResolvedValueOnce(new Uint8Array(32).fill(5))
      .mockResolvedValueOnce(new Uint8Array(32).fill(6));

    // Act
    const first = await service.derive(SALT);
    const second = await service.derive(SALT);

    // Assert
    expect(prfClient.evaluate).toHaveBeenCalledTimes(2);
    expect(second.publicKeyJwk).not.toEqual(first.publicKeyJwk);
  });
});
