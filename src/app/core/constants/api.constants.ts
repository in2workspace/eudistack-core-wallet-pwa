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
 * The full URL is `${window.location.origin}${WALLET_DISCOVERY_PATH}`.
 * The Spring backend registers this route via RouterFunction OUTSIDE the
 * `webflux.base-path=/business-wallet` prefix, so the correct resolved URL is
 * `https://<tenant-host>/.well-known/wallet-config-metadata` (no /business-wallet).
 */
export const WALLET_DISCOVERY_PATH = '/.well-known/wallet-config-metadata' as const;