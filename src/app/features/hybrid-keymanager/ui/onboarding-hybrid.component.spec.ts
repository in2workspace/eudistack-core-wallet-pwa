import { ComponentFixture, TestBed } from '@angular/core/testing';
import { OnboardingHybridComponent } from './onboarding-hybrid.component';
import { MemoryService } from '../memory.service';
import { PrfClientService } from '../prf-client.service';
import { WrapService } from '../wrap.service';
import { OnboardingHybridApi } from '../onboarding-hybrid.api';
import { AppError } from 'src/app/core/models/error/AppError';

describe('OnboardingHybridComponent', () => {
  let fixture: ComponentFixture<OnboardingHybridComponent>;
  let component: OnboardingHybridComponent;

  let mockApi: { init: jest.Mock; commit: jest.Mock; block: jest.Mock };
  let mockMemory: { set: jest.Mock };
  let mockPrf: {
    evaluateForWrap: jest.Mock,
    detectPrfSupport: jest.Mock,
  };
  let mockWrap: { generateHolderKeyPair: jest.Mock; deriveWrapKey: jest.Mock; wrapPrivateKey: jest.Mock; zeroize: jest.Mock };

  const CRED_ID = 'cred-component-test';
  const PRF_SALT_B64 = 'AAEC'; // short valid base64url
  const PRF_OUTPUT = new Uint8Array(32).fill(0x11);

  const PRIVATE_KEY = { type: 'private' } as CryptoKey;
  const WRAP_KEY = { type: 'secret' } as CryptoKey;
  const PUBLIC_KEY_JWK: JsonWebKey = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def' };
  const WRAPPED = { wrappedBlob: new Uint8Array(48), iv: new Uint8Array(12), tag: new Uint8Array(16) };

  beforeEach(async () => {
    mockApi = {
      init: jest.fn().mockResolvedValue({
        prf_salt: PRF_SALT_B64,
        kdf_params: '{}',
        signing_pubkey_envelope_format: 'SD-JWT',
      }),
      commit: jest.fn().mockResolvedValue({ credential_id: CRED_ID }),
      block: jest.fn().mockResolvedValue({}),
    };
    mockMemory = { set: jest.fn() };
    mockPrf = {
      detectPrfSupport: jest.fn().mockResolvedValue('enabled'),
      evaluateForWrap: jest.fn().mockResolvedValue(PRF_OUTPUT),
    };
    mockWrap = {
      generateHolderKeyPair: jest.fn().mockResolvedValue({ privateKey: PRIVATE_KEY, publicKeyJwk: PUBLIC_KEY_JWK }),
      deriveWrapKey: jest.fn().mockResolvedValue(WRAP_KEY),
      wrapPrivateKey: jest.fn().mockResolvedValue(WRAPPED),
      zeroize: jest.fn().mockResolvedValue(undefined),
    };

    await TestBed.configureTestingModule({
      imports: [OnboardingHybridComponent],
      providers: [
        { provide: OnboardingHybridApi, useValue: mockApi },
        { provide: MemoryService, useValue: mockMemory },
        { provide: PrfClientService, useValue: mockPrf },
        { provide: WrapService, useValue: mockWrap },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnboardingHybridComponent);
    component = fixture.componentInstance;
    component.credentialId = CRED_ID;
    fixture.detectChanges();
  });

  // ------------------------------------------------------------------ AC-01: full flow

  it('completes full enroll flow and emits enrolled event', async () => {
    const enrolledSpy = jest.fn();
    component.enrolled.subscribe(enrolledSpy);

    await component.enroll();

    expect(mockApi.init).toHaveBeenCalledWith({ credential_id: CRED_ID, format: 'vc+sd-jwt' });
    expect(mockPrf.evaluateForWrap).toHaveBeenCalled();
    expect(mockWrap.generateHolderKeyPair).toHaveBeenCalled();
    expect(mockWrap.deriveWrapKey).toHaveBeenCalledWith(PRF_OUTPUT, CRED_ID);
    expect(mockWrap.wrapPrivateKey).toHaveBeenCalledWith(PRIVATE_KEY, WRAP_KEY);
    expect(mockApi.commit).toHaveBeenCalled();
    expect(mockMemory.set).toHaveBeenCalledWith(CRED_ID, WRAP_KEY);
    expect(enrolledSpy).toHaveBeenCalledWith({ credentialId: CRED_ID });
    expect(component.state).toBe('done');
  });

  // ------------------------------------------------------------------ AC-03: no private key in commit body

  it('commit body does not contain the private key — only public material', async () => {
    await component.enroll();

    const commitBody = mockApi.commit.mock.calls[0][0];
    expect(commitBody).not.toHaveProperty('private_key');
    expect(commitBody).not.toHaveProperty('prf_output');
    expect(commitBody).toHaveProperty('cnf_jwk');
    expect(commitBody).toHaveProperty('wrapped_blob');
    expect(commitBody).toHaveProperty('iv');
    expect(commitBody).toHaveProperty('tag');
    expect(commitBody).toHaveProperty('kdf_algo', 'HKDF-SHA-256');
    expect(commitBody).toHaveProperty('kdf_version', 1);
  });

  // ------------------------------------------------------------------ ES-04: abort if PRF absent

  it('aborts and does not call commit if PRF ceremony throws', async () => {
    mockPrf.evaluateForWrap.mockRejectedValue(
      new AppError('PRF not available', { translationKey: 'hybrid.error.prfUnavailable' }),
    );
    const errorSpy = jest.fn();
    component.enrollmentError.subscribe(errorSpy);

    await component.enroll();

    expect(mockApi.commit).not.toHaveBeenCalled();
    expect(component.state).toBe('error');
    expect(errorSpy).toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ ES-05: private key always zeroized

  it('zeroizes private key even on successful enroll', async () => {
    await component.enroll();
    expect(mockWrap.zeroize).toHaveBeenCalledWith(PRIVATE_KEY);
  });

  it('zeroizes private key and wrap key on error', async () => {
    mockWrap.wrapPrivateKey.mockRejectedValue(new Error('wrap failed'));
    const errorSpy = jest.fn();
    component.enrollmentError.subscribe(errorSpy);

    await component.enroll();

    expect(mockWrap.zeroize).toHaveBeenCalledWith(PRIVATE_KEY);
    expect(mockWrap.zeroize).toHaveBeenCalledWith(WRAP_KEY);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('does NOT zeroize wrap key on success (it lives in MemoryService)', async () => {
    await component.enroll();

    // zeroize is called exactly once (for privateKey), not for wrapKey
    expect(mockWrap.zeroize).toHaveBeenCalledTimes(1);
    expect(mockWrap.zeroize).toHaveBeenCalledWith(PRIVATE_KEY);
    expect(mockWrap.zeroize).not.toHaveBeenCalledWith(WRAP_KEY);
  });

  it('blocks onboarding when PRF support is disabled', async () => {
    mockPrf.detectPrfSupport.mockResolvedValue('disabled');

    const errorSpy = jest.fn();
    component.enrollmentError.subscribe(errorSpy);

    await component.enroll();

    expect(component.state).toBe('prf-unsupported');

    expect(mockApi.init).not.toHaveBeenCalled();
    expect(mockPrf.evaluateForWrap).not.toHaveBeenCalled();
    expect(mockWrap.generateHolderKeyPair).not.toHaveBeenCalled();
    expect(mockApi.commit).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('does not continue onboarding when PRF detection is inconclusive', async () => {
    mockPrf.detectPrfSupport.mockResolvedValue('inconclusive');

    const errorSpy = jest.fn();
    component.enrollmentError.subscribe(errorSpy);

    await component.enroll();

    expect(component.state).toBe('prf-inconclusive');

    expect(mockApi.init).not.toHaveBeenCalled();
    expect(mockPrf.evaluateForWrap).not.toHaveBeenCalled();
    expect(mockWrap.generateHolderKeyPair).not.toHaveBeenCalled();
    expect(mockApi.commit).not.toHaveBeenCalled();

    expect(errorSpy).toHaveBeenCalled();
  });

  it('checks PRF support before generating holder keys', async () => {
    await component.enroll();

    expect(mockPrf.detectPrfSupport).toHaveBeenCalled();

    expect(
      mockPrf.detectPrfSupport.mock.invocationCallOrder[0]
    ).toBeLessThan(
      mockWrap.generateHolderKeyPair.mock.invocationCallOrder[0]
    );
  });

  it('calls block endpoint when PRF support is disabled', async () => {
    mockPrf.detectPrfSupport.mockResolvedValue('disabled');

    await component.enroll();

    expect(mockApi.block).toHaveBeenCalledWith({
      credential_id: CRED_ID,
      correlation_id: expect.any(String),
    });

    expect(mockApi.init).not.toHaveBeenCalled();
    expect(mockApi.commit).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------ state guard

  it('ignores concurrent enroll() calls while loading', async () => {
    component.state = 'loading';
    await component.enroll();
    expect(mockApi.init).not.toHaveBeenCalled();
  });
});
