const apiV1Path = '/api/v1';
const apiV1KeysPath = `${apiV1Path}/keys`;
const apiV1PasskeyPrfPath = `${apiV1KeysPath}/passkey-prf`;

const OPENID_OFFER = `${apiV1Path}/openid-credential-offer` as const;

export const SERVER_PATH = Object.freeze({
  ACTIVITY: `${apiV1Path}/activity`,
  CBOR : `${apiV1Path}/vp/cbor`,
  CREDENTIALS: `${apiV1Path}/credentials`,
  CREDENTIALS_SIGNED_BY_ID: `${apiV1Path}/request-signed-credential`,
  REQUEST_CREDENTIAL: OPENID_OFFER,
  CREDENTIAL_RESPONSE: `${OPENID_OFFER}/credential-response`,
  KEYS_GENERATE: `${apiV1KeysPath}/generate`,
  KEYS_IMPORT: `${apiV1KeysPath}/import`,
  KEYS_BY_ID: (keyId: string) => `${apiV1KeysPath}/${encodeURIComponent(keyId)}`,
  KEYS_SIGN: (keyId: string) => `${apiV1KeysPath}/${encodeURIComponent(keyId)}/sign`,
  KEYS_EXPORT: (keyId: string) => `${apiV1KeysPath}/${encodeURIComponent(keyId)}/export`,
  PASSKEY_PRF_SIGN_PREPARE: `${apiV1PasskeyPrfPath}/sign/prepare`,
  PASSKEY_PRF_SIGN_SUBMIT: `${apiV1PasskeyPrfPath}/sign/submit`,
  PASSKEY_PRF_CONSTRAINT_ACCEPTED: `${apiV1PasskeyPrfPath}/constraint-accepted`,
  PASSKEY_PRF_ONBOARDING_INIT: `${apiV1PasskeyPrfPath}/onboarding/init`,
  PASSKEY_PRF_ONBOARDING_COMMIT: `${apiV1PasskeyPrfPath}/onboarding/commit`,
  PASSKEY_PRF_ONBOARDING_BLOCK: `${apiV1PasskeyPrfPath}/onboarding/block`,
});

export const WALLET_DISCOVERY_PATH = '/business-wallet/.well-known/wallet-config-metadata' as const;
