import { TestBed } from '@angular/core/testing';
import { PasskeyPrfOnboardingService } from './passkey-prf-onboarding.service';

describe('PasskeyPrfOnboardingService', () => {
  let service: PasskeyPrfOnboardingService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [PasskeyPrfOnboardingService] });
    service = TestBed.inject(PasskeyPrfOnboardingService);
  });

  afterEach(() => sessionStorage.clear());

  it('returns false when acceptance has not been recorded', () => {
    expect(service.isAccepted()).toBe(false);
  });

  it('returns true after markAccepted()', () => {
    service.markAccepted();
    expect(service.isAccepted()).toBe(true);
  });

  it('persists acceptance across service instances within the same session', () => {
    service.markAccepted();
    const second = new PasskeyPrfOnboardingService();
    expect(second.isAccepted()).toBe(true);
  });
});
