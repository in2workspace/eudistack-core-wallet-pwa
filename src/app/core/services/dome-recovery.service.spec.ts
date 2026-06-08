import { TestBed } from '@angular/core/testing';
import { DomeRecoveryService } from './dome-recovery.service';
import { CredentialSyncPort } from '../spi/credential-sync.port';
import { DomeRecoveryStateService } from './dome-recovery-state.service';
import { IndexedDbCredentialStoreAdapter } from '../spi-impl/indexeddb-credential-store.adapter';
import { EbwCredentialStoreAdapter } from '../spi-impl/ebw-credential-store.adapter';
import { of } from 'rxjs';

describe('DomeRecoveryService', () => {
  let service: DomeRecoveryService;
  let syncPortMock: any;
  let stateServiceMock: any;
  let localStoreMock: any;
  let ebwStoreMock: any;

  beforeEach(() => {
    syncPortMock = { syncCredentials: jest.fn() };

    stateServiceMock = {
      getDomeIdempotencyKey: jest.fn(),
      setDomeIdempotencyKey: jest.fn(),
      setRecoveryInProgress: jest.fn(),
      setDomeRecoveryCompleted: jest.fn(),
      recoveryError: { set: jest.fn() }
    };

    localStoreMock = { setDomeRecoveryCompleted: jest.fn() };
    ebwStoreMock = { saveCredentials: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        DomeRecoveryService,
        { provide: CredentialSyncPort, useValue: syncPortMock },
        { provide: DomeRecoveryStateService, useValue: stateServiceMock },
        { provide: IndexedDbCredentialStoreAdapter, useValue: localStoreMock },
        { provide: EbwCredentialStoreAdapter, useValue: ebwStoreMock }
      ]
    });

    service = TestBed.inject(DomeRecoveryService);
  });

  it('AC-04: should reuse existing idempotency key from storage during synchronization retry', (done) => {
    const existingKey = '018f3a3c-b3a1-7b34-8c11-9a1f2b3c4d5e';
    stateServiceMock.getDomeIdempotencyKey.mockResolvedValue(existingKey);

    syncPortMock.syncCredentials.mockReturnValue(of({
      status: 'ok',
      timestamp: new Date().toISOString(),
      idempotencyKey: existingKey,
      credentials: []
    }));

    jest.spyOn(service as any, 'persistInLocalDb').mockImplementation(() => Promise.resolve());

    service.recover('test-thumbprint', 'local').subscribe({
      next: () => {
        try {
          expect(stateServiceMock.setDomeIdempotencyKey).not.toHaveBeenCalled();
          expect(syncPortMock.syncCredentials).toHaveBeenCalledWith({
            idempotencyKey: existingKey,
            holderKeyThumbprint: 'test-thumbprint'
          });
          done();
        } catch (err) {
          done(err);
        }
      }
    });
  });

  it('ES-08: should throw a critical error if local storage (IndexedDB) write operations fail', (done) => {
    stateServiceMock.getDomeIdempotencyKey.mockResolvedValue(null);

    syncPortMock.syncCredentials.mockReturnValue(of({
      status: 'ok',
      timestamp: new Date().toISOString(),
      idempotencyKey: 'new-key-123',
      credentials: [{ id: 'cred-1' }]
    }));

    jest.spyOn(service as any, 'persistInLocalDb')
      .mockImplementation(() => Promise.reject(new Error('Local storage persistence failed (IndexedDB)')));

    service.recover('test-thumbprint', 'local').subscribe({
      next: () => done('Should not succeed if database fails'),
      error: (err) => {
        try {
          expect(err.message).toContain('Local storage persistence failed');
          expect(stateServiceMock.setRecoveryInProgress).toHaveBeenCalledWith(false);
          expect(stateServiceMock.recoveryError.set).toHaveBeenCalled();
          done();
        } catch (err) {
          done(err);
        }
      }
    });
  });
});
