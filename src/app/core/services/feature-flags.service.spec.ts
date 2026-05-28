import { TestBed } from '@angular/core/testing';
import { FeatureFlagsService } from './feature-flags.service';

describe('FeatureFlagsService', () => {
  let service: FeatureFlagsService;
  let originalEnv: any;

  beforeEach(() => {
    originalEnv = (window as any).env;

    TestBed.configureTestingModule({
      providers: [FeatureFlagsService]
    });

    service = TestBed.inject(FeatureFlagsService);
  });

  afterEach(() => {
    (window as any).env = originalEnv;
  });

  it('AC-09: should default both DOME flags to false if window.env is completely undefined', () => {
    delete (window as any).env;

    expect(service.isDomeAutoRecoveryEnabled).toBe(false);
    expect(service.isDomeModeServerEnabled).toBe(false);
  });

  it('AC-09: should default to false if env object exists but DOME properties are missing', () => {
    (window as any).env = { wallet: { other_config: true } };

    expect(service.isDomeAutoRecoveryEnabled).toBe(false);
    expect(service.isDomeModeServerEnabled).toBe(false);
  });

  it('should return TRUE for isDomeAutoRecoveryEnabled when explicitly configured in env.js', () => {
    (window as any).env = {
      wallet: {
        dome: {
          auto_recovery: {
            enabled: true
          }
        }
      }
    };

    expect(service.isDomeAutoRecoveryEnabled).toBe(true);
    expect(service.isDomeModeServerEnabled).toBe(false);
  });

  it('should return TRUE for isDomeModeServerEnabled when explicitly configured in env.js', () => {
    (window as any).env = {
      wallet: {
        dome: {
          mode_server: true
        }
      }
    };

    expect(service.isDomeModeServerEnabled).toBe(true);
    expect(service.isDomeAutoRecoveryEnabled).toBe(false);
  });
});
