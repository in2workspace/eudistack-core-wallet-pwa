import { Injectable } from '@angular/core';

export type QrIntent =
  | { kind: 'credential-offer'; uri: string }
  | { kind: 'authorization-request'; uri: string }
  | { kind: 'unsupported' };

@Injectable({ providedIn: 'root' })
export class QrContentService {
  public parse(qrCode: string): QrIntent {
    if (!this.isSupported(qrCode)) {
      return { kind: 'unsupported' };
    }

    const uri = this.unwrap(qrCode);

    return qrCode.includes('credential_offer_uri')
      ? { kind: 'credential-offer', uri }
      : { kind: 'authorization-request', uri };
  }

  private isSupported(qrCode: string): boolean {
    return qrCode.includes('credential_offer_uri')
      || qrCode.startsWith('openid4vp://')
      || qrCode.includes('request_uri=')
      || qrCode.includes('request=')
      || qrCode.includes('authorization_request=');
  }

  private unwrap(qrCode: string): string {
    if (!qrCode.toLowerCase().startsWith('http')) {
      return qrCode;
    }

    try {
      const url = new URL(qrCode);
      return url.searchParams.get('credential_offer_uri')
        ?? url.searchParams.get('authorization_request')
        ?? qrCode;
    } catch {
      console.warn('Could not parse as URL; attempting to process the original string.');
      return qrCode;
    }
  }
}
