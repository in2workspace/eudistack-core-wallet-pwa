import { Observable } from 'rxjs';
import { SyncCredentialsRequest } from '../../domain/dome/sync-credentials.model';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';

export abstract class CredentialSyncPort {
  /**
   * Envía la petición al Issuer para sincronizar (recuperar) las credenciales de DOME.
   * @param request Datos de la petición (Idempotency Key y huella digital).
   * @returns Un Observable con el resultado final estructurado para la UI.
   */
  abstract syncCredentials(request: SyncCredentialsRequest): Observable<RecoveryOutcome>;
}
