import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';

export interface PasskeyInfo {
  id: string;
  displayName: string;
  createdAt: string;
}

const PASSKEYS_BASE = `${environment.server_url}/api/v1/passkeys`;

@Injectable({
  providedIn: 'root'
})
export class PasskeyService {
  private readonly http = inject(HttpClient);

  listPasskeys(): Observable<PasskeyInfo[]> {
    return this.http.get<PasskeyInfo[]>(PASSKEYS_BASE);
  }

  renamePasskey(id: string, displayName: string): Observable<PasskeyInfo> {
    return this.http.patch<PasskeyInfo>(`${PASSKEYS_BASE}/${id}`, { displayName });
  }

  deletePasskey(id: string): Observable<void> {
    return this.http.delete<void>(`${PASSKEYS_BASE}/${id}`);
  }
}
