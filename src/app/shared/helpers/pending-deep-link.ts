import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

/** Wallet screen that runs a credential offer received as `credential_offer_uri`. */
const CREDENTIAL_OFFER_ROUTE = '/tabs/credentials';

/** Returns the app-relative deep link saved before a redirect and clears it, or `null` when there is none. */
export function takePendingDeepLink(): string | null {
  const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
  return pendingLink;
}

/**
 * Saves a credential offer to be resumed once the session is open, the same
 * way as one that arrives before the access (`/tabs/credentials?credential_offer_uri=`).
 * Replaces any link saved before.
 */
export function savePendingCredentialOffer(offer: string): void {
  sessionStorage.setItem(PENDING_DEEP_LINK_KEY, `${CREDENTIAL_OFFER_ROUTE}?credential_offer_uri=${encodeURIComponent(offer)}`);
}

/** Forgets the deep link saved before a redirect, if any. */
export function clearPendingDeepLink(): void {
  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
}
