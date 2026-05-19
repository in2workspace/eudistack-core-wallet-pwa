const apiV1Path = '/api/v1';

const OPENID_OFFER = `${apiV1Path}/openid-credential-offer` as const;

export const SERVER_PATH = Object.freeze({
  CBOR : `${apiV1Path}/vp/cbor`,
  CREDENTIALS: `${apiV1Path}/credentials`,
  CREDENTIALS_SIGNED_BY_ID: `${apiV1Path}/request-signed-credential`,
  REQUEST_CREDENTIAL: OPENID_OFFER,
  CREDENTIAL_RESPONSE: `${OPENID_OFFER}/credential-response`,
});

/**
 * Path of the EBW public discovery endpoint (EUDISTACK-412).
 *
 * The full URL is `${environment.server_url}${WALLET_DISCOVERY_PATH}`.
 * In production `environment.server_url` expands to
 * `${window.location.origin}/business-wallet`, so the resolved URL is
 * `https://<tenant-host>/business-wallet/.well-known/wallet-config-metadata`.
 * In local dev `environment.server_url` is `http://localhost:8083` (EBW dev port,
 * which mounts the well-known under its own base-path `/business-wallet`).
 */
export const WALLET_DISCOVERY_PATH = '/.well-known/wallet-config-metadata' as const;