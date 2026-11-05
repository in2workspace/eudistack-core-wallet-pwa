const apiV1Path = '/api/v1';
const apiV1KeysPath = `${apiV1Path}/keys`;
const apiV1PasskeyPrfSaltsPath = `${apiV1KeysPath}/passkey-prf/salts`;

const OPENID_OFFER = `${apiV1Path}/openid-credential-offer` as const;

export const SERVER_PATH = Object.freeze({
  ACTIVITY: `${apiV1Path}/activity`,
  CBOR : `${apiV1Path}/vp/cbor`,
  CREDENTIALS: `${apiV1Path}/credentials`,
  CREDENTIALS_SIGNED_BY_ID: `${apiV1Path}/request-signed-credential`,
  REQUEST_CREDENTIAL: OPENID_OFFER,
  CREDENTIAL_RESPONSE: `${OPENID_OFFER}/credential-response`,
  KEYS_GENERATE: `${apiV1KeysPath}/generate`,
  KEYS_SIGN: (keyId: string) => `${apiV1KeysPath}/${encodeURIComponent(keyId)}/sign`,
  PASSKEY_PRF_SALTS: apiV1PasskeyPrfSaltsPath,
  PASSKEY_PRF_SALT: (credentialId: string) => `${apiV1PasskeyPrfSaltsPath}/${encodeURIComponent(credentialId)}`,
});

export const WALLET_DISCOVERY_PATH = '/business-wallet/.well-known/wallet-config-metadata' as const;
