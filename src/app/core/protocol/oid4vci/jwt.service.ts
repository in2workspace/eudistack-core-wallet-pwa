import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class JwtService {

  public parseJwtPayload(jwt: string): unknown {
  const parts = jwt.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT format (missing payload).');
  }

  const payloadB64Url = parts[1];
  const payloadBytes = this.base64UrlDecodeToBytes(payloadB64Url);
  const payloadJson = new TextDecoder().decode(payloadBytes);

  try {
    return JSON.parse(payloadJson);
  } catch {
    throw new Error('JWT payload is not valid JSON.');
  }
}

public base64UrlDecodeToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

  public base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  base64EncodeUtf8(input: string): string {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }

    return btoa(binary); // Standard Base64 with + / and =
  }
}
