/**
 * Label of the HKDF-SHA-256 step that turns the PRF output of the passkey into the P-256 holder key.
 * The service sends it with the salt; this is the value it currently gives.
 */
export const PASSKEY_PRF_HKDF_INFO = 'eudistack:passkey-prf:p256:v1';

/** HKDF without salt: the PRF output is already uniformly random. */
export const PASSKEY_PRF_HKDF_SALT = new Uint8Array(0);
