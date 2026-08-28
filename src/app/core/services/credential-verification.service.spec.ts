import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import * as pako from 'pako';
import { CredentialVerificationService } from './credential-verification.service';
import { VerifiableCredential } from '../models/verifiable-credential';

describe('CredentialVerificationService', () => {
  let service: CredentialVerificationService;
  let httpTestingController: HttpTestingController;

  const STATUS_LIST_URL = 'https://issuer.example.com/status-list/1';

  function buildCredential(overrides: any = {}): VerifiableCredential {
    return {
      '@context': [],
      id: 'vc-1',
      lifeCycleStatus: 'VALID',
      issuer: { id: 'issuer-1' },
      validFrom: '2026-01-01T00:00:00.000Z',
      validUntil: '2030-01-01T00:00:00.000Z',
      credentialSubject: {} as any,
      credentialStatus: {
        id: 'status-1',
        type: 'BitstringStatusListEntry',
        statusPurpose: 'revocation',
        statusListIndex: '0',
        statusListCredential: STATUS_LIST_URL,
      },
      ...overrides,
    };
  }

  // btoa/atob-based base64url encoding — avoids relying on Node's Buffer, which
  // isn't typed in this browser-targeted tsconfig.
  function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function jsonToBase64Url(value: unknown): string {
    const json = JSON.stringify(value);
    const bytes = new Uint8Array(json.length);
    for (let i = 0; i < json.length; i++) {
      bytes[i] = json.charCodeAt(i);
    }
    return bytesToBase64Url(bytes);
  }

  // Builds a minimal SD-JWT-shaped status list JWT carrying a single-byte
  // bitstring, with bit 0 (the only index used by these tests) set or unset.
  function buildStatusListJwt(bitSet: boolean): string {
    const rawBytes = new Uint8Array([bitSet ? 0x80 : 0x00]);
    const compressed = pako.deflate(rawBytes);
    const encodedList = 'u' + bytesToBase64Url(compressed);
    const payload = { vc: { credentialSubject: { encodedList } } };
    return `${jsonToBase64Url({ alg: 'none' })}.${jsonToBase64Url(payload)}.`;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CredentialVerificationService],
    });
    service = TestBed.inject(CredentialVerificationService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  describe('isRevoked', () => {
    it('should return "not-revoked" when the status list confirms the bit is unset', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush(buildStatusListJwt(false));
      const result = await resultPromise;

      // Assert
      expect(result).toBe('not-revoked');
    });

    it('should return "revoked" when the status list confirms the bit is set', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush(buildStatusListJwt(true));
      const result = await resultPromise;

      // Assert
      expect(result).toBe('revoked');
    });

    it('should return "unknown", never "not-revoked", when the status list request fails', async () => {
      // Arrange
      const credential = buildCredential({ lifeCycleStatus: 'VALID' });

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController
        .expectOne(STATUS_LIST_URL)
        .flush('unavailable', { status: 503, statusText: 'Service Unavailable' });
      const result = await resultPromise;

      // Assert — fail-open regression guard: a network/backend error must never
      // be reported as a confirmed "not-revoked" result.
      expect(result).toBe('unknown');
      expect(result).not.toBe('not-revoked');
    });

    it('should return "unknown", never "not-revoked", when the response body is not a parseable JWT', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush('this is not a jwt');
      const result = await resultPromise;

      // Assert — a 200 response with unparseable content is uncertainty too, not
      // a confirmed "not revoked" answer.
      expect(result).toBe('unknown');
      expect(result).not.toBe('not-revoked');
    });

    it('should return "unknown", never "not-revoked", when statusListIndex is not numeric', async () => {
      // Arrange
      const credential = buildCredential({
        credentialStatus: {
          id: 'status-1',
          type: 'BitstringStatusListEntry',
          statusPurpose: 'revocation',
          statusListIndex: 'not-a-number',
          statusListCredential: STATUS_LIST_URL,
        },
      });

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush(buildStatusListJwt(false));
      const result = await resultPromise;

      // Assert
      expect(result).toBe('unknown');
      expect(result).not.toBe('not-revoked');
    });

    it('should return "revoked" when the response is unparseable but the credential was already known REVOKED locally', async () => {
      // Arrange
      const credential = buildCredential({ lifeCycleStatus: 'REVOKED' });

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush('this is not a jwt');
      const result = await resultPromise;

      // Assert
      expect(result).toBe('revoked');
    });

    it('should return "revoked" when the request fails but the credential was already known REVOKED locally', async () => {
      // Arrange
      const credential = buildCredential({ lifeCycleStatus: 'REVOKED' });

      // Act
      const resultPromise = service.isRevoked(credential);
      httpTestingController
        .expectOne(STATUS_LIST_URL)
        .flush('unavailable', { status: 500, statusText: 'Server Error' });
      const result = await resultPromise;

      // Assert
      expect(result).toBe('revoked');
    });

    it('should fall back to the local lifeCycleStatus without an HTTP call when there is no status list', async () => {
      // Arrange
      const credential = buildCredential({ credentialStatus: undefined, lifeCycleStatus: 'REVOKED' });

      // Act
      const result = await service.isRevoked(credential);

      // Assert
      expect(result).toBe('revoked');
      httpTestingController.expectNone(STATUS_LIST_URL);
    });
  });

  describe('runCheck("status")', () => {
    it('should return a "passed" check when the credential is not revoked', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.runCheck('status', credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush(buildStatusListJwt(false));
      const result = await resultPromise;

      // Assert
      expect(result).toEqual({ key: 'status', status: 'passed' });
    });

    it('should return a "failed" check with the revoked detail when the credential is revoked', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.runCheck('status', credential);
      httpTestingController.expectOne(STATUS_LIST_URL).flush(buildStatusListJwt(true));
      const result = await resultPromise;

      // Assert
      expect(result).toEqual({ key: 'status', status: 'failed', detail: 'verification.detail-revoked' });
    });

    it('should return an "error" check, never "passed", when the status list request fails', async () => {
      // Arrange
      const credential = buildCredential();

      // Act
      const resultPromise = service.runCheck('status', credential);
      httpTestingController
        .expectOne(STATUS_LIST_URL)
        .flush('unavailable', { status: 500, statusText: 'Server Error' });
      const result = await resultPromise;

      // Assert — the regression this Story fixes: a network failure must surface
      // as an explicit "could not verify" state, never as a silent "passed".
      expect(result.status).toBe('error');
      expect(result.status).not.toBe('passed');
      expect(result.detail).toBe('verification.detail-check-error');
    });

    it('should return a "passed" check with the no-status-list detail when the credential has no status list', async () => {
      // Arrange
      const credential = buildCredential({ credentialStatus: undefined, lifeCycleStatus: 'VALID' });

      // Act
      const result = await service.runCheck('status', credential);

      // Assert
      expect(result).toEqual({ key: 'status', status: 'passed', detail: 'verification.detail-no-status-list' });
      httpTestingController.expectNone(STATUS_LIST_URL);
    });
  });
});
