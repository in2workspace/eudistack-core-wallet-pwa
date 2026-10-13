import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { takePendingDeepLink } from './pending-deep-link';

describe('takePendingDeepLink', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns the saved deep link and clears it', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?credentialOfferUri=abc');

    const result = takePendingDeepLink();

    expect(result).toBe('/tabs/credentials?credentialOfferUri=abc');
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('returns null when nothing is pending', () => {
    const result = takePendingDeepLink();

    expect(result).toBeNull();
  });
});
