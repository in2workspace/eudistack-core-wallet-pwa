import { DefaultUrlSerializer } from '@angular/router';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { clearPendingDeepLink, savePendingCredentialOffer, takePendingDeepLink } from './pending-deep-link';

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

describe('savePendingCredentialOffer (EUD-315)', () => {
  beforeEach(() => sessionStorage.clear());

  it('saves the offer as the credentials deep link, replacing any other', () => {
    const offer = 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fo%2F1';
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/vc-selector?x=1');

    savePendingCredentialOffer(offer);

    const link = sessionStorage.getItem(PENDING_DEEP_LINK_KEY) ?? '';
    expect(link).toBe(`/tabs/credentials?credential_offer_uri=${encodeURIComponent(offer)}`);
    expect(new URLSearchParams(link.split('?')[1]).get('credential_offer_uri')).toBe(offer);
  });
});

describe('pending credential offer read back by the router (EUD-315, AC-11)', () => {
  beforeEach(() => sessionStorage.clear());

  it('gives the credentials page the whole offer in credential_offer_uri', () => {
    const offer = 'openid-credential-offer://?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fcredential-offer%2F3f2a';
    savePendingCredentialOffer(offer);

    const tree = new DefaultUrlSerializer().parse(takePendingDeepLink() ?? '');

    expect(tree.root.children['primary'].segments.map(s => s.path)).toEqual(['tabs', 'credentials']);
    expect(tree.queryParams['credential_offer_uri']).toBe(offer);
  });

  it('keeps a standard pending offer saved by the guard untouched', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/protocol/callback?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fo');

    expect(takePendingDeepLink()).toBe('/protocol/callback?credential_offer_uri=https%3A%2F%2Fissuer.example%2Fo');
  });
});

describe('clearPendingDeepLink (EUD-315)', () => {
  it('forgets the saved deep link', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?credential_offer_uri=abc');

    clearPendingDeepLink();

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });
});
