const apiV1Path = '/api/v1';

export const WEBSOCKET_PIN_PATH = `${apiV1Path}/pin`;
export const WEBSOCKET_NOTIFICATION_PATH = `${apiV1Path}/notification`;

const OPENID_OFFER = `${apiV1Path}/openid-credential-offer` as const;

export const SERVER_PATH = Object.freeze({
  CBOR : `${apiV1Path}/vp/cbor`,
  CREDENTIALS: `${apiV1Path}/credentials`,
  CREDENTIALS_SIGNED_BY_ID: `${apiV1Path}/request-signed-credential`,
  EXECUTE_CONTENT: `${apiV1Path}/execute-content`,
  REQUEST_CREDENTIAL: OPENID_OFFER,
  CREDENTIAL_RESPONSE: `${OPENID_OFFER}/credential-response`,
  VERIFIABLE_PRESENTATION_CREDENTIALS: `${apiV1Path}/vp/credentials`
});