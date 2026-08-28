import { TestBed } from '@angular/core/testing';
import { HybridOnboardingService } from './hybrid-onboarding.service';

describe('HybridOnboardingService', () => {
  let service: HybridOnboardingService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [HybridOnboardingService] });
    service = TestBed.inject(HybridOnboardingService);
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
    const second = new HybridOnboardingService();
    expect(second.isAccepted()).toBe(true);
  });
});
