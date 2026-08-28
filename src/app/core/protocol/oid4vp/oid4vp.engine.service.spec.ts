import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Oid4vpEngineService } from './oid4vp.engine.service';
import { KeyStorageProvider } from '../../spi/key-storage.provider.service';
import { LoaderHandledFlowService } from 'src/app/shared/services/loader-handled-flow.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CredentialCacheService } from 'src/app/shared/services/credential-cache.service';
import { ActivityService } from 'src/app/core/services/activity.service';
import { VCReply } from 'src/app/core/models/verifiable-credential-reply';

// [SIGN-OFF GATED — D-2] Shared-attribute capture at the OID4VP presentation point (AD-2):
// deriveSharedAttributeNames() must exclude registered JWT/SD-JWT-VC claims and surface only
// the disclosed claim names, and the resulting list must flow through into the 'presented'
// activity log entry (NFR-P-02). JwtService and SdJwtParserService are left as their real,
// pure implementations (no external deps) so these SD-JWTs are genuinely parsed, not stubbed.

// ── SD-JWT test fixture builder (RFC 9901 shape: <issuer-jwt>~<disclosure>~...~) ────────────
//
// Uses only browser-standard APIs (TextEncoder, btoa) — no Node `crypto`/`Buffer`, which this
// project's browser tsconfig does not type. The SHA-256 routine below is the same pure-JS,
// dependency-free implementation SdJwtParserService uses internally, duplicated here so this
// fixture builder can compute matching `_sd` digests without reaching into that private code.

function utf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(value: unknown): string {
  return base64UrlEncodeBytes(utf8Bytes(JSON.stringify(value)));
}

function encodeDisclosure(salt: string, name: string, value: unknown): string {
  return b64urlJson([salt, name, value]);
}

function sha256Base64Url(input: string): string {
  return base64UrlEncodeBytes(fixtureSha256(utf8Bytes(input)));
}

// ── Pure JS SHA-256 (RFC 6234), mirrored from SdJwtParserService's private implementation ──

const SHA256_K: number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

function fixtureSha256(message: Uint8Array): Uint8Array {
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const msgLen = message.length;
  const bitLen = msgLen * 8;

  const padLen = (((msgLen + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(padLen);
  padded.set(message);
  padded[msgLen] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen, false);

  const w = new Int32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) | 0;

      h = g; g = f; f = e; e = (d + temp1) | 0;
      d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }

    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }

  const result = new Uint8Array(32);
  const rv = new DataView(result.buffer);
  rv.setUint32(0, h0, false); rv.setUint32(4, h1, false);
  rv.setUint32(8, h2, false); rv.setUint32(12, h3, false);
  rv.setUint32(16, h4, false); rv.setUint32(20, h5, false);
  rv.setUint32(24, h6, false); rv.setUint32(28, h7, false);
  return result;
}

/** Builds a compact SD-JWT with the given registered claims and disclosed (selectively-disclosable) fields. */
function buildSdJwt(registeredClaims: Record<string, unknown>, disclosedFields: Array<[string, unknown]>): string {
  const disclosures = disclosedFields.map(([name, value], i) => encodeDisclosure(`salt-${i}`, name, value));
  const sdDigests = disclosures.map(sha256Base64Url);

  const header = b64urlJson({ alg: 'ES256', typ: 'vc+sd-jwt' });
  const payload = b64urlJson({ ...registeredClaims, _sd: sdDigests, _sd_alg: 'sha-256' });
  const issuerJwt = `${header}.${payload}.sig`;

  return `${issuerJwt}~${disclosures.join('~')}~`;
}

const HOLDER_CNF = { jwk: { kty: 'EC', crv: 'P-256', x: 'holder-x', y: 'holder-y' } };

// ── TestBed wiring ───────────────────────────────────────────────────────────────────────────

function buildKeyStorageProviderMock(): jest.Mocked<KeyStorageProvider> {
  return {
    computeJwkThumbprint: jest.fn().mockResolvedValue('thumbprint-1'),
    resolveKeyIdByKid: jest.fn().mockResolvedValue('key-1'),
    sign: jest.fn().mockResolvedValue(new Uint8Array(64)),
    // buildPresentationJws intentionally omitted: forces the browser-mode signJwt() fallback.
  } as unknown as jest.Mocked<KeyStorageProvider>;
}

function setup() {
  const keyStorageProvider = buildKeyStorageProviderMock();
  const credentialCacheService = { extractSignedJwt: jest.fn() };
  const activityService = { log: jest.fn().mockResolvedValue(undefined) };
  const walletService = { postOid4vpAuthorizationResponse: jest.fn().mockReturnValue(of('ok')) };
  const loaderHandledFlowService = { run: jest.fn().mockImplementation((opts: { fn: () => Promise<unknown> }) => opts.fn()) };

  TestBed.configureTestingModule({
    providers: [
      Oid4vpEngineService,
      { provide: KeyStorageProvider, useValue: keyStorageProvider },
      { provide: LoaderHandledFlowService, useValue: loaderHandledFlowService },
      { provide: WalletService, useValue: walletService },
      { provide: CredentialCacheService, useValue: credentialCacheService },
      { provide: ActivityService, useValue: activityService },
      // JwtService and SdJwtParserService are NOT overridden — the real, pure implementations
      // run so the crafted SD-JWTs above are genuinely parsed via reconstructClaims().
    ],
  });

  const service = TestBed.inject(Oid4vpEngineService);
  return { service, keyStorageProvider, credentialCacheService, activityService, walletService, loaderHandledFlowService };
}

function selectorResponseFor(credentialEncoded: string, overrides: Partial<VCReply> = {}): VCReply {
  return {
    selectedVcList: [{ name: 'Empleado ACME', type: ['LEARCredentialEmployee'], credentialEncoded } as any],
    nonce: 'nonce-1',
    state: 'state-1',
    redirectUri: 'https://verifier.example.com/callback',
    clientId: 'https://verifier.example.com',
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  TestBed.resetTestingModule();
});

describe('Oid4vpEngineService.deriveSharedAttributeNames (D-2 / AD-2)', () => {
  it('excludes registered JWT/SD-JWT-VC claims and returns only the disclosed attribute names', () => {
    const { service } = setup();
    const sdJwt = buildSdJwt(
      {
        iss: 'https://issuer.example.com',
        iat: 1_700_000_000,
        exp: 1_700_003_600,
        vct: 'https://example.com/credentials/employee',
        cnf: HOLDER_CNF,
      },
      [['given_name', 'Jane'], ['family_name', 'Doe']]
    );

    const result: string[] = (service as any).deriveSharedAttributeNames(sdJwt);

    expect([...result].sort()).toEqual(['family_name', 'given_name']);
    for (const registered of ['iss', 'iat', 'exp', 'cnf', 'vct', '_sd', '_sd_alg']) {
      expect(result).not.toContain(registered);
    }
  });

  it('handles disclosed claims of different value types (string, number, boolean)', () => {
    const { service } = setup();
    const sdJwt = buildSdJwt(
      { iss: 'https://issuer.example.com', iat: 1, exp: 2, vct: 'vct-x' },
      [['email', 'jane@example.com'], ['age', 33], ['active', true]]
    );

    const result: string[] = (service as any).deriveSharedAttributeNames(sdJwt);

    expect([...result].sort()).toEqual(['active', 'age', 'email']);
  });

  it('returns an empty array (EC-01) when the SD-JWT discloses no non-registered claims', () => {
    const { service } = setup();
    const sdJwt = buildSdJwt(
      { iss: 'https://issuer.example.com', iat: 1_700_000_000, exp: 1_700_003_600, vct: 'vct-x' },
      []
    );

    const result: string[] = (service as any).deriveSharedAttributeNames(sdJwt);

    expect(result).toEqual([]);
  });

  it('degrades to EC-01 (empty array) instead of throwing when the SD-JWT cannot be parsed', () => {
    const { service } = setup();
    const malformed = 'not-a-valid-jwt~garbage-disclosure~';

    let result: string[] | undefined;
    expect(() => { result = (service as any).deriveSharedAttributeNames(malformed); }).not.toThrow();
    expect(result).toEqual([]);
  });
});

describe('Oid4vpEngineService — shared attributes flow into the "presented" activity log (D-2 / NFR-P-02)', () => {
  it('logs the presented activity with sharedAttributes derived from the disclosed SD-JWT claims', async () => {
    const { service, credentialCacheService, activityService } = setup();
    const sdJwt = buildSdJwt(
      {
        iss: 'https://issuer.example.com',
        iat: 1_700_000_000,
        exp: 1_700_003_600,
        vct: 'https://example.com/credentials/employee',
        cnf: HOLDER_CNF,
      },
      [['given_name', 'Jane'], ['family_name', 'Doe']]
    );
    credentialCacheService.extractSignedJwt.mockReturnValue(sdJwt);
    jest.spyOn(service as any, 'computeSdHash').mockResolvedValue('fake-sd-hash');

    await service.buildVerifiablePresentationWithSelectedVCs(selectorResponseFor(sdJwt));

    expect(activityService.log).toHaveBeenCalledTimes(1);
    const [type, credName, counterparty, details, sharedAttributes] = activityService.log.mock.calls[0];
    expect(type).toBe('presented');
    expect(credName).toBe('Empleado ACME');
    expect(counterparty).toBe('https://verifier.example.com');
    expect(details).toBeUndefined();
    expect([...(sharedAttributes as string[])].sort()).toEqual(['family_name', 'given_name']);
  });

  it('logs sharedAttributes as an empty array (EC-01) when the presented SD-JWT discloses nothing extra', async () => {
    const { service, credentialCacheService, activityService } = setup();
    const sdJwt = buildSdJwt(
      { iss: 'https://issuer.example.com', iat: 1_700_000_000, exp: 1_700_003_600, vct: 'vct-x', cnf: HOLDER_CNF },
      []
    );
    credentialCacheService.extractSignedJwt.mockReturnValue(sdJwt);
    jest.spyOn(service as any, 'computeSdHash').mockResolvedValue('fake-sd-hash');

    await service.buildVerifiablePresentationWithSelectedVCs(selectorResponseFor(sdJwt));

    const [, , , , sharedAttributes] = activityService.log.mock.calls[0];
    expect(sharedAttributes).toEqual([]);
  });

  it('does not derive sharedAttributes (undefined) for a non-SD-JWT (jwt_vc_json) presentation', async () => {
    const { service, credentialCacheService, activityService } = setup();
    const header = b64urlJson({ alg: 'ES256', typ: 'JWT' });
    const payload = b64urlJson({
      iss: 'did:key:zHolder',
      credentialSubject: { id: 'did:key:zHolder' },
      cnf: HOLDER_CNF,
    });
    const plainJwt = `${header}.${payload}.sig`; // no '~' => not an SD-JWT

    credentialCacheService.extractSignedJwt.mockReturnValue(plainJwt);

    await service.buildVerifiablePresentationWithSelectedVCs(selectorResponseFor(plainJwt));

    expect(activityService.log).toHaveBeenCalledTimes(1);
    const [type, , , , sharedAttributes] = activityService.log.mock.calls[0];
    expect(type).toBe('presented');
    expect(sharedAttributes).toBeUndefined();
  });
});
