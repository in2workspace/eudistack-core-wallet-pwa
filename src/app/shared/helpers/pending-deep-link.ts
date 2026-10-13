import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

/** Returns the app-relative deep link saved before a redirect and clears it, or `null` when there is none. */
export function takePendingDeepLink(): string | null {
  const pendingLink = sessionStorage.getItem(PENDING_DEEP_LINK_KEY);
  sessionStorage.removeItem(PENDING_DEEP_LINK_KEY);
  return pendingLink;
}
