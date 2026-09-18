import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { IssuerNotificationService, NOTIFICATION_EVENT } from './issuer-notification.service';

describe('IssuerNotificationService', () => {
  let service: IssuerNotificationService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [IssuerNotificationService]
    });
    service = TestBed.inject(IssuerNotificationService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should send notification to the provided endpoint with correct headers and body', () => {
    const endpoint = 'https://issuer.com/notify';
    const accessToken = 'token-123';
    const notificationId = 'notif-456';
    const event = NOTIFICATION_EVENT.CREDENTIAL_ACCEPTED;
    const description = 'User accepted the credential';

    service.notifyIssuer(endpoint, accessToken, notificationId, event, description).subscribe();

    const req = httpMock.expectOne(endpoint);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-123');
    expect(req.request.headers.get('Content-Type')).toBe('application/json');
    expect(req.request.body).toEqual({
      notificationId: 'notif-456',
      event: 'credential_accepted',
      eventDescription: description
    });
    req.flush(null);
  });
});
