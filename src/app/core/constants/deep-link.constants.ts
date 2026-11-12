export const PENDING_DEEP_LINK_KEY = 'wallet_pending_deep_link';

/** App-relative path prefixes that a second tab forwards to the leader tab as a deep link. */
export const DEEP_LINK_PATH_PREFIXES = ['/protocol/', '/tabs/vc-selector', '/tabs/credentials'] as const;

/**
 * EUD-315 (task 46): app-relative paths whose value travels in the fragment, the onboarding ticket
 * (`/t#<ticket>`) and the "it was not me" token (`/no-he-sido-yo#<token>`). A second tab forwards them,
 * fragment included, to the leader tab, which opens them with or without a session: their pages need none.
 * Exact paths: `/t` must not match `/tabs/...`.
 */
export const FRAGMENT_LINK_PATHS = ['/t', '/no-he-sido-yo'] as const;
