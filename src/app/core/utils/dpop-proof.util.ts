import { generateUuidV7 } from './uuid-v7.util';

export interface DpopPayload {
  jti: string;
  htm: string;
  htu: string;
  iat: number;
}

/**
 * Genera los claims necesarios para construir la prueba DPoP (Proof of Possession).
 * Estos datos luego se firmarán con la clave privada del móvil (Web Crypto API)
 * para generar el JWT final que viaja en la cabecera 'DPoP'.
 * * @param httpMethod El mét-odo de la petición, por ejemplo 'POST' o 'GET'
 * @param url La URL de destino (ej. 'https://api.tudominio.com/internal/dome/sync-credentials')
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
