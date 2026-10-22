import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { passkeyPrfOnboardingGuard, passkeyPrfOnboardingRouteGuard } from './passkey-prf-onboarding.guard';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { PasskeyPrfOnboardingService } from '../services/passkey-prf-onboarding.service';
import { WalletDiscoverySnapshot } from '../models/wallet-discovery.model';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

const mockSnapshot = (keyManager: string | null): WalletDiscoverySnapshot => ({
  mode: keyManager ? 'server' : 'browser',
  source: 'discovery',
  keyManager,
  resolvedAt: Date.now(),
});

describe('passkeyPrfOnboardingGuard', () => {
  let router: jest.Mocked<Pick<Router, 'createUrlTree'>>;
  let discovery: { snapshot: jest.Mock };
  let passkeyPrfOnboarding: { isAccepted: jest.Mock };

  beforeEach(() => {
    router = { createUrlTree: jest.fn().mockReturnValue('/passkey-prf-onboarding' as any) };
    discovery = { snapshot: jest.fn() };
    passkeyPrfOnboarding = { isAccepted: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: WalletDiscoveryService, useValue: discovery },
        { provide: PasskeyPrfOnboardingService, useValue: passkeyPrfOnboarding },
      ],
    });
  });

  it('redirects to /passkey-prf-onboarding when keyManager is passkey-prf and not yet accepted', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, {} as any));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/passkey-prf-onboarding']);
    expect(result).toBe('/passkey-prf-onboarding' as any);
  });

  it('saves the original target as pending deep link when redirecting to onboarding', () => {
    sessionStorage.clear();
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(false);
    const state = { url: '/tabs/credentials?credentialOfferUri=abc' };

    TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, state as any));

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/tabs/credentials?credentialOfferUri=abc');
  });

  it('does not save a pending deep link when the target is the root', () => {
    sessionStorage.clear();
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(false);

    TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, { url: '/' } as any));

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('does not save a pending deep link when already accepted', () => {
    sessionStorage.clear();
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(true);

    TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, { url: '/tabs/credentials' } as any));

    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('passes through when keyManager is passkey-prf and already accepted', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('passes through when keyManager is db', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('db')));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('passes through when snapshot is null', () => {
    discovery.snapshot.mockReturnValue(signal(null));
    passkeyPrfOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });
});

describe('passkeyPrfOnboardingRouteGuard', () => {
  let router: jest.Mocked<Pick<Router, 'createUrlTree'>>;
  let discovery: { snapshot: jest.Mock };

  beforeEach(() => {
    router = { createUrlTree: jest.fn().mockReturnValue('/' as any) };
    discovery = { snapshot: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: WalletDiscoveryService, useValue: discovery },
      ],
    });
  });

  it('allows access when keyManager is passkey-prf', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('passkey-prf')));

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingRouteGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('redirects to / when keyManager is not passkey-prf', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('db')));

    const result = TestBed.runInInjectionContext(() => passkeyPrfOnboardingRouteGuard({} as any, {} as any));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
    expect(result).toBe('/' as any);
  });
});
