import { inject, Injectable } from '@angular/core';
import { JwtService } from './jwt.service';

@Injectable({ providedIn: 'root' })
export class PkceService {
  private readonly jwtService = inject(JwtService);

  issueCodeVerifier(): string {
    const bytes = new Uint8Array(32);
    globalThis.crypto.getRandomValues(bytes);
    return this.jwtService.base64UrlEncode(bytes);
  }

  async issueCodeChallenge(codeVerifier: string): Promise<string> {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(codeVerifier)
    );
    return this.jwtService.base64UrlEncode(new Uint8Array(digest));
  }
}
