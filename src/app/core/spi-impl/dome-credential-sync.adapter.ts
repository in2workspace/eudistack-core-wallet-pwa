import {Injectable, Injector} from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import {from, Observable, of, switchMap} from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { SyncCredentialsRequest } from '../../domain/dome/sync-credentials.model';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';
import { buildDpopClaims } from '../utils/dpop-proof.util';
import { AuthService } from '../services/auth.service';
import {DpopService} from "../protocol/oid4vci/dpop.service";

@Injectable({
  providedIn: 'root'
})
export class DomeCredentialSyncAdapter implements CredentialSyncPort {

  private readonly SYNC_URL = '/issuer/internal/dome/sync-credentials';

  constructor(
    private http: HttpClient,
    private injector: Injector
  ) {}

  syncCredentials(request: SyncCredentialsRequest): Observable<RecoveryOutcome> {

    const fullUrl = window.location.origin + this.SYNC_URL;

    // 1. Extraemos los servicios bajo demanda para evitar bucles
    const dpopService = this.injector.get(DpopService);
    const authService = this.injector.get(AuthService);
    const token = authService.getToken();

    // 2. Generamos la firma DPoP real y encadenamos con la petición HTTP
    return from(dpopService.issueProof('POST', fullUrl)).pipe(
      switchMap(dpopProof => {

        // 3. Montamos las cabeceras base con la firma DPoP generada
        let headers = new HttpHeaders({
          'Content-Type': 'application/json',
          'Idempotency-Key': request.idempotencyKey,
          'DPoP': dpopProof.jwt
        });

        // 4. Añadimos el token si existe
        if (token) {
          headers = headers.set('Authorization', `Bearer ${token}`);
        }

        // 5. Hacemos la llamada real al backend
        return this.http.post<any>(this.SYNC_URL, request, { headers });
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

    /*const fullUrl = window.location.origin + this.SYNC_URL;

    // 1. Generamos la prueba criptógrafica DPoP
    return from(this.dpopService.issueProof('POST', fullUrl).catch(err =>{
      console.error('Error fatal generando DPoP:', err);
      throw new Error('DPoP_FAILED');
    }))
      .pipe(
        switchMap(dpopProof => {
          // 2. Obtenemos token
          const authService = this.injector.get(AuthService);
          const accessToken = authService.getToken();

          // 3. Montamos cabeceras base
          let headers = new HttpHeaders({
            'Content/Type': 'application/json',
            'Idempotency-Key': request.idempotencyKey,
            'DPoP': dpopProof.jwt
          });

          // 4. Añadimos el token de autorización si existe
          if (accessToken) {
            headers = headers.set('Authorization', `Bearer ${accessToken}`);
          } else {
            console.warn('[DOME Sync] Aviso: Realizando petición sin Bearer Token.');
          }

          // 5. Disparamos la petición HTTP
          return this.http.post<any>(this.SYNC_URL, request, { headers });
        }),

        // 6. Mapeamos la respuesta exitosa
        map(response => {
          return {
            status: response.credentials && response.credentials.length > 0 ? 'ok' : 'empty',
            credentials: response.credentials || [],
            timestamp: new Date().toISOString(),
            idempotencyKey: request.idempotencyKey
          } as RecoveryOutcome;
        }),

        // 7. Manejo de Errores
        catchError(error => {
          console.error('Error de red/auth en la sincronización DOME:', error);

          // Extraemos el mensaje del backend si existe
          const errorMessage = error.error?.detail || error.message || 'Error de sincronización.';

          return of({
            status: 'error',
            message: errorMessage,
            timestamp: new Date().toISOString(),
            idempotencyKey: request.idempotencyKey
          } as RecoveryOutcome);
        })
      );*/
  }
}
