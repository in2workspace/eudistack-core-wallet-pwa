import { HttpErrorResponse } from '@angular/common/http';
import { SessionExpiryMarkerService } from './session-expiry-marker.service';

describe('SessionExpiryMarkerService', () => {
  let service: SessionExpiryMarkerService;

  beforeEach(() => {
    service = new SessionExpiryMarkerService();
  });

  it('reports an error as session-expired only after it has been marked', () => {
    const err = new HttpErrorResponse({ status: 401 });

    expect(service.isSessionExpired(err)).toBe(false);

    service.markSessionExpired(err);

    expect(service.isSessionExpired(err)).toBe(true);
  });

  it('does not confuse two distinct error instances', () => {
    const markedErr = new HttpErrorResponse({ status: 401 });
    const otherErr = new HttpErrorResponse({ status: 401 });

    service.markSessionExpired(markedErr);

    expect(service.isSessionExpired(markedErr)).toBe(true);
    expect(service.isSessionExpired(otherErr)).toBe(false);
  });
});
