import { TestBed } from '@angular/core/testing';
import {
  HttpClientTestingModule,
  HttpTestingController,
} from '@angular/common/http/testing';
import { WalletService } from './wallet.service';
import { environment } from 'src/environments/environment';
import {
  CredentialStatus,
  VerifiableCredential,
} from '../models/verifiable-credential';
import { SERVER_PATH } from '../constants/api.constants';
import { LocalCredentialStorageService } from './local-credential-storage.service';
import { CredentialParserService } from '../utils/credential-parser.util';

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

describe('WalletService', () => {
  let service: WalletService;
  let httpTestingController: HttpTestingController;
  let mockCredentialStorage: {
    getAllCredentials: jest.Mock;
    deleteCredential: jest.Mock;
    updateCredentialStatus: jest.Mock;
    saveCredential: jest.Mock;
  };

  beforeEach(() => {
    mockCredentialStorage = {
      getAllCredentials: jest.fn().mockResolvedValue([mockCredential]),
      deleteCredential: jest.fn().mockResolvedValue(undefined),
      updateCredentialStatus: jest.fn().mockResolvedValue(undefined),
      saveCredential: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        WalletService,
        { provide: LocalCredentialStorageService, useValue: mockCredentialStorage },
        { provide: CredentialParserService, useValue: { parseCredentialResponse: jest.fn() } },
      ],
    });
    service = TestBed.inject(WalletService);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

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
