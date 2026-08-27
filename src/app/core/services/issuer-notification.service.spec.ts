import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { IssuerNotificationService, NOTIFICATION_EVENT } from './issuer-notification.service';

describe('IssuerNotificationService', () => {
  let service: IssuerNotificationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(IssuerNotificationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  // Regression test: OID4VCI 1.0 FINAL §11.1 names these fields notification_id/
  // event_description (snake_case). This service used to send the camelCase Java-style
  // keys the Issuer's own NotificationRequest happened to accept only by coincidence
  // (mirror-image bug there, now fixed) — a spec-conformant issuer never receives a valid
  // notification_id from this body shape.
  it('posts the notification body using snake_case field names', () => {
    service.notifyIssuer(
      'https://issuer.example.com/oid4vci/v1/notification',
      'access-token',
      'notif-123',
      NOTIFICATION_EVENT.CREDENTIAL_ACCEPTED,
      'accepted by the holder',
    ).subscribe();

    const req = http.expectOne('https://issuer.example.com/oid4vci/v1/notification');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      notification_id: 'notif-123',
      event: NOTIFICATION_EVENT.CREDENTIAL_ACCEPTED,
      event_description: 'accepted by the holder',
    });
    req.flush(null);
  });
});
