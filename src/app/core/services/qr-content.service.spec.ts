import { TestBed } from '@angular/core/testing';
import { QrContentService } from './qr-content.service';

describe('QrContentService', () => {
  let service: QrContentService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(QrContentService);
  });

  it('reports unsupported content', () => {
    expect(service.parse('not-supported-content')).toEqual({ kind: 'unsupported' });
  });

  it('extracts the credential offer URI wrapped in a URL', () => {
    const qr = 'https://issuer.com/api?credential_offer_uri=openid-credential-offer://encoded-data';

    expect(service.parse(qr)).toEqual({
      kind: 'credential-offer',
      uri: 'openid-credential-offer://encoded-data',
    });
  });

  it('keeps a direct credential offer string as-is', () => {
    const qr = 'credential_offer_uri=direct-vci-data';

    expect(service.parse(qr)).toEqual({ kind: 'credential-offer', uri: qr });
  });

  it('classifies an openid4vp deep link as an authorization request', () => {
    const qr = 'openid4vp://authorize?request_uri=https://verifier.com';

    expect(service.parse(qr)).toEqual({ kind: 'authorization-request', uri: qr });
  });

  it('extracts the authorization request wrapped in a URL', () => {
    const qr = 'https://verifier.com/cb?authorization_request=openid4vp://inner';

    expect(service.parse(qr)).toEqual({
      kind: 'authorization-request',
      uri: 'openid4vp://inner',
    });
  });

  it('falls back to the original string when the URL cannot be parsed', () => {
    const qr = 'http://[malformed?request_uri=x';

    expect(service.parse(qr)).toEqual({ kind: 'authorization-request', uri: qr });
  });
});
