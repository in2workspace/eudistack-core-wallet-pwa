import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { SyncCredentialsRequest } from '../../domain/dome/sync-credentials.model';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';
import { buildDpopClaims } from '../utils/dpop-proof.util';

@Injectable({
  providedIn: 'root'
})
export class DomeCredentialSyncAdapter implements CredentialSyncPort {

  private readonly SYNC_URL = '/issuer/internal/dome/sync-credentials';

  constructor(
    private http: HttpClient
    // Aquí inyectarías tu servicio de Auth/Crypto si necesitas obtener el Token o firmar
    // private authService: AuthService,
    // private cryptoService: CryptoService
  ) {}

  syncCredentials(request: SyncCredentialsRequest): Observable<RecoveryOutcome> {

    const dpopPayload = buildDpopClaims('POST', window.location.origin + this.SYNC_URL);
    // const signedDpop = this.cryptoService.sign(dpopPayload); // (Firmar con clave privada)
    // const token = this.authService.getAccessToken();

    let headers = new HttpHeaders({
      'Content-Type': 'application/json',
      'Idempotency-Key': request.idempotencyKey
      // Descomenta esto si no usas un Interceptor global:
      // 'Authorization': `Bearer ${token}`,
      // 'DPoP': signedDpop
    });

    return this.http.post<any>(this.SYNC_URL, request, { headers }).pipe(
      map(response => {
        return {
          status: response.credentials && response.credentials.length > 0 ? 'ok' : 'empty',
          credentials: response.credentials || [],
          timestamp: new Date().toISOString(),
          idempotencyKey: request.idempotencyKey
        } as RecoveryOutcome;git
      }),
      catchError(error => {
        console.error('Error en la sincronización DOME:', error);
        const errorMessage = error.error?.detail || 'Error inesperado al recuperar credenciales.';

        return of({
          status: 'error',
          message: errorMessage,
          timestamp: new Date().toISOString(),
          idempotencyKey: request.idempotencyKey
        } as RecoveryOutcome);
      })
    );
  }
}
