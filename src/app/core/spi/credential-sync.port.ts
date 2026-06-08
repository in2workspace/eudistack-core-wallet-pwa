import { Observable } from 'rxjs';
import { SyncCredentialsRequest } from '../../domain/dome/sync-credentials.model';
import { RecoveryOutcome } from '../../domain/dome/recovery-outcome.model';

export abstract class CredentialSyncPort {
  /**
   * Sends a credential synchronization (recovery) request to the Issuer.
   * @param request Request payload containing the idempotency key and holder key thumbprint.
   * @returns An Observable containing the recovery outcome.
   */
  abstract syncCredentials(request: SyncCredentialsRequest): Observable<RecoveryOutcome>;
}
