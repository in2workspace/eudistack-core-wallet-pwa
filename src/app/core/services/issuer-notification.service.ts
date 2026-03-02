import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';

export const NOTIFICATION_EVENT = {
  CREDENTIAL_ACCEPTED: 'credential_accepted',
  CREDENTIAL_DELETED: 'credential_deleted',
  CREDENTIAL_FAILURE: 'credential_failure',
} as const;

export type NotificationEventType = typeof NOTIFICATION_EVENT[keyof typeof NOTIFICATION_EVENT];

@Injectable({ providedIn: 'root' })
export class IssuerNotificationService {

  private readonly http = inject(HttpClient);

  notifyIssuer(
    notificationEndpoint: string,
    accessToken: string,
    notificationId: string,
    event: NotificationEventType,
    eventDescription: string,
  ): Observable<void> {
    const headers = new HttpHeaders({
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    });

    const body = { notificationId, event, eventDescription };

    return this.http.post<void>(notificationEndpoint, body, { headers });
  }
}
