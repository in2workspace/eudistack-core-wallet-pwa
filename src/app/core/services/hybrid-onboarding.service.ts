import { Injectable } from '@angular/core';

const ACCEPTED_KEY = 'hybrid-onboarding-accepted';

@Injectable({ providedIn: 'root' })
export class HybridOnboardingService {
  isAccepted(): boolean {
    return sessionStorage.getItem(ACCEPTED_KEY) === 'true';
  }

  markAccepted(): void {
    sessionStorage.setItem(ACCEPTED_KEY, 'true');
  }
}
