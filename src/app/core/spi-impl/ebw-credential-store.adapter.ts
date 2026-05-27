import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

/**
 * Adaptador para el modo "Server" (EBW - Enterprise Backend Wallet).
 * Actualmente es un stub (simulacro) hasta que se implemente la conexión real.
 */
@Injectable({
  providedIn: 'root'
})
export class EbwCredentialStoreAdapter {

  // TODO D-tech-1 ref EUDISTACK-411: Implementar la delegación de persistencia al backend EBW.

  constructor() {}

  /**
   * Simula el guardado de credenciales en el servidor EBW.
   */
  saveCredentials(credentials: any[]): Observable<boolean> {
    console.warn('[EbwCredentialStoreAdapter] saveCredentials is a stub. Delegating to EBW not yet implemented.');
    return of(true); // Simulamos que siempre va bien
  }

  // Si vuestro puerto (CredentialStorePort) tiene más métodos,
  // se añadirían aquí devolviendo un 'of(true)' o valores por defecto.
}
