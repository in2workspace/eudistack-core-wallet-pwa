import {Injectable, Injector} from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {from, Observable, of, switchMap} from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { SyncCredentialsRequest } from '../../domain/dome/sync-credentials.model';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';
import { AuthService } from '../services/auth.service';
import {DpopService} from "../protocol/oid4vci/dpop.service";

@Injectable({
  providedIn: 'root'
})
export class DomeCredentialSyncAdapter implements CredentialSyncPort {

  private readonly syncUrl = '/issuer/internal/dome/sync-credentials';

  constructor(
    private http: HttpClient,
    private injector: Injector
  ) {}

  syncCredentials(request: SyncCredentialsRequest): Observable<RecoveryOutcome> {

    const fullUrl = window.location.origin + this.syncUrl;
    const dpopService = this.injector.get(DpopService);
    const authService = this.injector.get(AuthService);
    const token = authService.getToken();

    return from(dpopService.issueProof('POST', fullUrl)).pipe(
      switchMap(dpopProof => {

        let headers = new HttpHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
          'DPoP': dpopProof.jwt
        });

        if (token) {
          headers = headers.set('Authorization', `Bearer ${token}`);
        }

        return this.http.post<any>(this.syncUrl, request, { headers });
      }),
      map(response => {
        return {
          status: response.credentials && response.credentials.length > 0 ? 'ok' : 'empty',
          credentials: response.credentials || [],
          timestamp: new Date().toISOString(),
          idempotencyKey: request.idempotencyKey
        } as RecoveryOutcome;
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
