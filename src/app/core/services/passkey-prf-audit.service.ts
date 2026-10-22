import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { SERVER_PATH } from '../constants/api.constants';
import { UrlResolverService } from './url-resolver.service';

@Injectable({ providedIn: 'root' })
export class PasskeyPrfAuditService {
  private readonly http = inject(HttpClient);
  private readonly urlResolver = inject(UrlResolverService);

  recordConstraintAccepted(): Observable<void> {
    const url = `${this.urlResolver.serverUrl()}${SERVER_PATH.PASSKEY_PRF_CONSTRAINT_ACCEPTED}`;
    return this.http.post<void>(url, {});
  }
}
