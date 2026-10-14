import { Injectable } from '@angular/core';

const ACCEPTED_KEY = 'passkey-prf-onboarding-accepted';

@Injectable({ providedIn: 'root' })
export class PasskeyPrfOnboardingService {
  isAccepted(): boolean {
    return sessionStorage.getItem(ACCEPTED_KEY) === 'true';
  }

  markAccepted(): void {
    sessionStorage.setItem(ACCEPTED_KEY, 'true');
  }
}
