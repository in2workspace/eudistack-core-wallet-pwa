import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';

@Injectable({ providedIn: 'root' })
export class NonceService {
  private readonly http = inject(HttpClient);

  async fetchNonce(nonceEndpoint: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ c_nonce: string; c_nonce_expires_in: number }>(
          nonceEndpoint, null
        )
      );

      if (!response?.c_nonce) {
        throw new Oid4vciError('Nonce response missing c_nonce', {
          translationKey: 'errors.nonce-failed',
        });
      }

      return response.c_nonce;
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;
      wrapOid4vciHttpError(e, 'Nonce request failed', {
        translationKey: 'errors.nonce-failed',
      });
    }
  }
}
