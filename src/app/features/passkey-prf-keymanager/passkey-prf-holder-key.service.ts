import { inject, Injectable } from '@angular/core';
import { DerivedP256Key, deriveP256KeyFromBytes } from 'src/app/core/utils/p256-key-derivation.util';
import { PASSKEY_PRF_HKDF_INFO, PASSKEY_PRF_HKDF_SALT } from './passkey-prf-kdf.const';
import { PrfClientService } from './prf-client.service';

/**
 * Derives the holder key of an attestation with passkey custody: one use of the passkey of the session
 * (PRF over the salt of the attestation) and HKDF-SHA-256. There is no cache: every signature derives its
 * own key, signs and drops it. The PRF output is zero-filled as soon as the key is derived.
 */
@Injectable({ providedIn: 'root' })
export class PasskeyPrfHolderKeyService {
  private readonly prfClient = inject(PrfClientService);

  async derive(prfSalt: Uint8Array, info: string = PASSKEY_PRF_HKDF_INFO): Promise<DerivedP256Key> {
    const prfOutput = await this.prfClient.evaluate(prfSalt);
    try {
      return await deriveP256KeyFromBytes(prfOutput, PASSKEY_PRF_HKDF_SALT, info);
    } finally {
      prfOutput.fill(0);
    }
  }
}
