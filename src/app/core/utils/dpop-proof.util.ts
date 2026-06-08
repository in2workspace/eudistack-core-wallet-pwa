import { generateUuidV7 } from './uuid-v7.util';

export interface DpopPayload {
  jti: string;
  htm: string;
  htu: string;
  iat: number;
}

/**
 * Builds the standard DPoP claims required to create a proof JWT.
 * The returned payload is intended to be signed with the client's private key
 * and included in the DPoP request header.
 * @param httpMethod HTTP method of the request.
 * @param url        Target request URL.
 */
export function buildDpopClaims(httpMethod: string, url: string): DpopPayload {
  const cleanUrl = new URL(url);
  const htu = `${cleanUrl.origin}${cleanUrl.pathname}`;

  return {
    jti: generateUuidV7(),
    htm: httpMethod.toUpperCase(),
    htu: htu,
    iat: Math.floor(Date.now() / 1000)
  };
}
