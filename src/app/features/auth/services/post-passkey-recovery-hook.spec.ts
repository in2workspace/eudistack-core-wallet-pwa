import { TestBed } from '@angular/core/testing';
import { PostPasskeyRecoveryHook } from './post-passkey-recovery-hook';
import { FeatureFlagsService } from '../../../core/services/feature-flags.service';
import { DomeRecoveryStateService } from '../../../core/services/dome-recovery-state.service';
import { DomeRecoveryService } from '../../../core/services/dome-recovery.service';
import { of, throwError } from 'rxjs';

describe('PostPasskeyRecoveryHook', () => {
  let hook: PostPasskeyRecoveryHook;
  let featureFlagsMock: any;
  let stateServiceMock: any;
  let recoveryServiceMock: any;

  beforeEach(() => {
    featureFlagsMock = {
      isDomeAutoRecoveryEnabled: true,
      isDomeModeServerEnabled: false
    };

    stateServiceMock = {
      getDomeRecoveryCompleted: jest.fn()
    };

    recoveryServiceMock = {
      recover: jest.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        PostPasskeyRecoveryHook,
        { provide: FeatureFlagsService, useValue: featureFlagsMock },
        { provide: DomeRecoveryStateService, useValue: stateServiceMock },
        { provide: DomeRecoveryService, useValue: recoveryServiceMock }
      ]
    });

    hook = TestBed.inject(PostPasskeyRecoveryHook);
  });

  it('AC-05: should abort execution immediately if feature flag is OFF', () => {

    featureFlagsMock.isDomeAutoRecoveryEnabled = false;

    hook.execute('dummy-thumbprint');
    expect(recoveryServiceMock.recover).not.toHaveBeenCalled();
  });

  it('AC-10: should abort execution if recovery was already marked as completed', () => {

    stateServiceMock.getDomeRecoveryCompleted.mockReturnValue(true);

    hook.execute('dummy-thumbprint');
    expect(recoveryServiceMock.recover).not.toHaveBeenCalled();
  });

  it('EC-03: should safely abort if the completed marker is corrupted (truthy garbage data)', () => {

    stateServiceMock.getDomeRecoveryCompleted.mockReturnValue('corrupted_string_data');

    hook.execute('dummy-thumbprint');
    expect(recoveryServiceMock.recover).not.toHaveBeenCalled();
  });

  it('ES-09: should silently catch and handle PrfNotAvailableError without disrupting application stability', () => {

    stateServiceMock.getDomeRecoveryCompleted.mockReturnValue(false);

    const prfError = new Error('PRF unavailable on this device');
    prfError.name = 'PrfNotAvailableError';
    recoveryServiceMock.recover.mockReturnValue(throwError(() => prfError));

    expect(() => hook.execute('dummy-thumbprint')).not.toThrow();
    expect(recoveryServiceMock.recover).toHaveBeenCalled();
  });

})
