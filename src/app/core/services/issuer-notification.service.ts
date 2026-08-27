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

    // OID4VCI 1.0 FINAL §11.1 names these fields notification_id/event_description
    // (snake_case) - sending the camelCase Java-style keys this file always used only
    // "worked" because the Issuer's own NotificationRequest had the mirror-image bug
    // (matching only notificationId, until fixed to accept both - see the companion fix
    // in eudistack-core-issuer). A spec-conformant issuer expects snake_case here.
    const body = { notification_id: notificationId, event, event_description: eventDescription };

    return this.http.post<void>(notificationEndpoint, body, { headers });
  }
}
