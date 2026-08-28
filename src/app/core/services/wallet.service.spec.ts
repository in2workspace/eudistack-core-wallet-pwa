import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { WalletService } from './wallet.service';
import { environment } from 'src/environments/environment';
import {
  CredentialStatus, LifeCycleStatus,
  VerifiableCredential,
} from '../models/verifiable-credential';
import { SERVER_PATH } from '../constants/api.constants';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { CredentialParserService } from '../utils/credential-parser.util';
import { WalletDiscoveryService } from './wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from '../gateways/wallet-discovery.gateway';
import { of } from 'rxjs';
import {FinalizeIssuancePayload} from "../models/FinalizeIssuancePayload";
import { CredentialCacheService } from '../../shared/services/credential-cache.service';

const mockCredential: VerifiableCredential = {
  '@context': ['https://www.w3.org/ns/credentials/v1'],
  id: 'test-credential-id',
  type: ['VerifiableCredential', 'learcredential.employee.w3c.4'],
  issuer: {
    id: 'did:web:provider.dome.fiware.dev',
  },
  validFrom: '2024-04-02T09:23:22.637345122Z',
  validUntil: '2025-01-01T00:00:00Z',
  credentialSubject: {
    mandate: {
      id: 'mandateId1',
      mandator: {
        commonName: 'Common Name',
        serialNumber: 'serialNumber1',
        organization: 'Organization Name',
        country: 'Country',
        organizationIdentifier: 'mandatorId1'
      },
      mandatee: {
        id: 'personId1',
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        employeeId: '',
        domain: '',
        ipAddress: ''
      },
      power: [
        {
          id: 'powerId1',
          type: 'Domain',
          domain: 'DOME',
          function: 'Onboarding',
          action: ['Execute'],
        },
      ]
    },
  },
  lifeCycleStatus: "ISSUED",
  credentialStatus: {} as CredentialStatus,
};

/** Minimal fake gateway — never hits the network. */
const fakeGateway = { fetch: () => of() };

/** Creates a WalletDiscoveryService stub that returns the given mode synchronously. */
function makeDiscoveryStub(resolvedMode: 'browser' | 'server'): Partial<WalletDiscoveryService> {
  return { mode: () => resolvedMode };
}

describe('WalletService', () => {
  let service: WalletService;
  let httpTestingController: HttpTestingController;
  let mockCredentialStorage: {
    getAllCredentials: jest.Mock;
    deleteCredential: jest.Mock;
    updateCredentialStatus: jest.Mock;
    saveCredential: jest.Mock;
    clearAllCredentials: jest.Mock;
    replaceAllCredentials: jest.Mock;
  };
  let credentialCache: CredentialCacheService;

  function createModule(walletMode: 'browser' | 'server' = 'browser'): void {
    mockCredentialStorage = {
      getAllCredentials: jest.fn().mockResolvedValue([mockCredential]),
      deleteCredential: jest.fn().mockResolvedValue(undefined),
      updateCredentialStatus: jest.fn().mockResolvedValue(undefined),
      saveCredential: jest.fn().mockResolvedValue(undefined),
      clearAllCredentials: jest.fn().mockResolvedValue(undefined),
      replaceAllCredentials: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        WalletService,
        { provide: LocalCredentialStorageService, useValue: mockCredentialStorage },
        { provide: CredentialParserService, useValue: { parseCredentialResponse: jest.fn() } },
        { provide: WalletDiscoveryService, useValue: makeDiscoveryStub(walletMode) },
        { provide: WALLET_DISCOVERY_GATEWAY, useValue: fakeGateway },
      ],
    });
    service = TestBed.inject(WalletService);
    httpTestingController = TestBed.inject(HttpTestingController);
    credentialCache = TestBed.inject(CredentialCacheService);
    credentialCache.setLoaded([]); // reset reactive state between tests
  }

  afterEach(() => {
    httpTestingController.verify();
    TestBed.resetTestingModule();
  });

  // ---------------------------------------------------------------------------
  // Existing tests (browser mode)
  // ---------------------------------------------------------------------------

  describe('browser mode (default)', () => {
    beforeEach(() => createModule('browser'));

    it('should return credentialEncoded for getVCinCBOR in browser mode', (done) => {
      const credWithEncoded = { ...mockCredential, credentialEncoded: 'encoded-data' };

      service.getVCinCBOR(credWithEncoded).subscribe((response) => {
        expect(response).toEqual('encoded-data');
        done();
      });
    });

    it('should return empty string for getVCinCBOR when no credentialEncoded', (done) => {
      service.getVCinCBOR(mockCredential).subscribe((response) => {
        expect(response).toEqual('');
        done();
      });
    });

    it('should fetch all Verifiable Credentials from local storage in browser mode', (done) => {
      service.getAllVCs().subscribe((credentials) => {
        expect(credentials.length).toBe(1);
        expect(credentials[0].id).toBe('test-credential-id');
        expect(mockCredentialStorage.getAllCredentials).toHaveBeenCalled();
        done();
      });
    });

    it('should delete a Verifiable Credential by id in browser mode', (done) => {
      const VC = 'test-vc-id';

      service.deleteVC(VC).subscribe(() => {
        expect(mockCredentialStorage.deleteCredential).toHaveBeenCalledWith(VC);
        done();
      });
    });

    it('should return 204 for requestSignature in browser mode', (done) => {
      service.requestSignature('test-id').subscribe((response) => {
        expect(response.status).toBe(204);
        done();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // T-15: WalletService > isBrowserMode > reads from WalletDiscoveryService
  // ---------------------------------------------------------------------------

  describe('T-15: isBrowserMode reads from WalletDiscoveryService (AC-009.2c, AC-009.3c)', () => {
    it('should use local credential storage when discovery returns browser mode', (done) => {
      createModule('browser');

      service.getAllVCs().subscribe((credentials) => {
        expect(credentials.length).toBe(1);
        expect(mockCredentialStorage.getAllCredentials).toHaveBeenCalled();
        done();
      });
    });

    it('should read credentials from IndexedDB in server mode', (done) => {
      createModule('server');

      service.getAllVCs().subscribe((credentials) => {
        expect(credentials.length).toBe(1);
        expect(mockCredentialStorage.getAllCredentials).toHaveBeenCalled();
        done();
      });
    });

    it('should sync credentials from server to IndexedDB on login (atomic replace)', async () => {
      createModule('server');

      service.syncCredentials().subscribe();

      await Promise.resolve();

      // Server is fetched FIRST, before touching local storage.
      const req = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CREDENTIALS
      );

      expect(req.request.method).toBe('GET');

      req.flush([mockCredential]);

      await Promise.resolve();

      // Atomic swap: single replaceAllCredentials call, no clear+save-per-item.
      expect(mockCredentialStorage.replaceAllCredentials)
        .toHaveBeenCalledWith([mockCredential]);
      expect(mockCredentialStorage.clearAllCredentials).not.toHaveBeenCalled();
    });

    it('should return credentialEncoded from local in browser mode (via discovery)', (done) => {
      createModule('browser');
      const cred = { ...mockCredential, credentialEncoded: 'cbor-data' };

      service.getVCinCBOR(cred).subscribe((result) => {
        expect(result).toBe('cbor-data');
        done();
      });
    });

    it('should POST to CBOR endpoint in server mode (via discovery)', (done) => {
      createModule('server');

      service.getVCinCBOR(mockCredential).subscribe((result) => {
        expect(result).toBe('cbor-encoded');
        done();
      });

      const req = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CBOR
      );
      expect(req.request.method).toBe('POST');
      req.flush('cbor-encoded');
    });

    it('should delete credential locally in browser mode (via discovery)', (done) => {
      createModule('browser');

      service.deleteVC('cred-id').subscribe(() => {
        expect(mockCredentialStorage.deleteCredential).toHaveBeenCalledWith('cred-id');
        done();
      });
    });

    it('should DELETE credential remotely in server mode (via discovery)', (done) => {
      createModule('server');

      service.deleteVC('cred-id').subscribe(() => {
        done();
      });

      const req = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CREDENTIALS + '/cred-id'
      );
      expect(req.request.method).toBe('DELETE');
      req.flush('');
    });

    it('should delete credential from IndexedDB after successful server delete', (done) => {
      createModule('server');

      service.deleteVC('cred-id').subscribe(() => {
        expect(mockCredentialStorage.deleteCredential)
          .toHaveBeenCalledWith('cred-id');

        done();
      });

      const req = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CREDENTIALS + '/cred-id'
      );

      expect(req.request.method).toBe('DELETE');

      req.flush('');
    });

    it('should update credential status in IndexedDB after successful server update', (done) => {
      createModule('server');

      service.updateCredentialStatus(
        'cred-id',
        'REVOKED' as LifeCycleStatus
      ).subscribe(() => {

        expect(mockCredentialStorage.updateCredentialStatus)
          .toHaveBeenCalledWith(
            'cred-id',
            'REVOKED'
          );

        done();
      });

      const req = httpTestingController.expectOne(
        `${environment.server_url}${SERVER_PATH.CREDENTIALS}/cred-id/status`
      );

      expect(req.request.method).toBe('PATCH');

      req.flush({});
    });

    it('should resync IndexedDB after server credential issuance', async () => {
      createModule('server');

      const payload = {} as FinalizeIssuancePayload;

      service.finalizeCredentialIssuance(payload).subscribe();

      const postReq = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CREDENTIAL_RESPONSE
      );

      expect(postReq.request.method).toBe('POST');

      postReq.flush({});

      await Promise.resolve(); // <-- añade esto

      const getReq = httpTestingController.expectOne(
        environment.server_url + SERVER_PATH.CREDENTIALS
      );

      expect(getReq.request.method).toBe('GET');

      getReq.flush([mockCredential]);

      await Promise.resolve();

      expect(mockCredentialStorage.replaceAllCredentials)
        .toHaveBeenCalledWith([mockCredential]);
    });
  });

  // ---------------------------------------------------------------------------
  // refreshCredentials: reactive store transitions
  // ---------------------------------------------------------------------------

  describe('refreshCredentials', () => {
    it('should load from local storage and set the store to loaded', (done) => {
      createModule('browser');

      service.refreshCredentials().subscribe(() => {
        expect(mockCredentialStorage.getAllCredentials).toHaveBeenCalled();
        expect(credentialCache.status()).toBe('loaded');
        expect(credentialCache.snapshot().credentials.length).toBe(1);
        done();
      });
    });

    it('should set error status WITHOUT clearing the existing list on failure', (done) => {
      createModule('browser');
      credentialCache.setLoaded([mockCredential]); // pre-existing list
      mockCredentialStorage.getAllCredentials.mockRejectedValueOnce(new Error('IndexedDB down'));

      service.refreshCredentials().subscribe(() => {
        expect(credentialCache.status()).toBe('error');
        // list preserved — a transient failure must not blank the wallet
        expect(credentialCache.snapshot().credentials.length).toBe(1);
        done();
      });
    });

    it('should treat an empty result as a loaded-empty wallet (not an error)', (done) => {
      createModule('browser');
      mockCredentialStorage.getAllCredentials.mockResolvedValueOnce([]);

      service.refreshCredentials().subscribe(() => {
        expect(credentialCache.status()).toBe('loaded');
        expect(credentialCache.snapshot().credentials.length).toBe(0);
        done();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // postOid4vpAuthorizationResponse — must send withCredentials, since this call
  // is cross-origin (wallet.<tenant>.* -> verifier.<tenant>.*) and the Verifier's
  // SSO session cookie only reaches the browser if the request opts into
  // credentials (see EUDISTACK-548 investigation).
  // ---------------------------------------------------------------------------
  describe('postOid4vpAuthorizationResponse', () => {
    beforeEach(() => createModule('browser'));

    it('sends the request with withCredentials so the SSO session cookie can be stored', (done) => {
      service.postOid4vpAuthorizationResponse('https://verifier.dome.example/oid4vp/auth-response', 'state-1', 'vp-token-1')
        .subscribe(() => done());

      const req = httpTestingController.expectOne('https://verifier.dome.example/oid4vp/auth-response');
      expect(req.request.withCredentials).toBe(true);
      req.flush('ok');
    });
  });
});
