import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { hybridOnboardingGuard, hybridOnboardingRouteGuard } from './hybrid-onboarding.guard';
import { WalletDiscoveryService } from '../services/wallet-discovery.service';
import { HybridOnboardingService } from '../services/hybrid-onboarding.service';
import { WalletDiscoverySnapshot } from '../models/wallet-discovery.model';

const mockSnapshot = (keyManager: string | null): WalletDiscoverySnapshot => ({
  mode: keyManager ? 'server' : 'browser',
  source: 'discovery',
  keyManager,
  resolvedAt: Date.now(),
});

describe('hybridOnboardingGuard', () => {
  let router: jest.Mocked<Pick<Router, 'createUrlTree'>>;
  let discovery: { snapshot: jest.Mock };
  let hybridOnboarding: { isAccepted: jest.Mock };

  beforeEach(() => {
    router = { createUrlTree: jest.fn().mockReturnValue('/hybrid-onboarding' as any) };
    discovery = { snapshot: jest.fn() };
    hybridOnboarding = { isAccepted: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: WalletDiscoveryService, useValue: discovery },
        { provide: HybridOnboardingService, useValue: hybridOnboarding },
      ],
    });
  });

  it('redirects to /hybrid-onboarding when keyManager is hybrid and not yet accepted', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('hybrid')));
    hybridOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => hybridOnboardingGuard({} as any, {} as any));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/hybrid-onboarding']);
    expect(result).toBe('/hybrid-onboarding' as any);
  });

  it('passes through when keyManager is hybrid and already accepted', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('hybrid')));
    hybridOnboarding.isAccepted.mockReturnValue(true);

    const result = TestBed.runInInjectionContext(() => hybridOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('passes through when keyManager is db', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('db')));
    hybridOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => hybridOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('passes through when snapshot is null', () => {
    discovery.snapshot.mockReturnValue(signal(null));
    hybridOnboarding.isAccepted.mockReturnValue(false);

    const result = TestBed.runInInjectionContext(() => hybridOnboardingGuard({} as any, {} as any));

    expect(result).toBe(true);
  });
});

describe('hybridOnboardingRouteGuard', () => {
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

  it('allows access when keyManager is hybrid', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('hybrid')));

    const result = TestBed.runInInjectionContext(() => hybridOnboardingRouteGuard({} as any, {} as any));

    expect(result).toBe(true);
  });

  it('redirects to / when keyManager is not hybrid', () => {
    discovery.snapshot.mockReturnValue(signal(mockSnapshot('db')));

    const result = TestBed.runInInjectionContext(() => hybridOnboardingRouteGuard({} as any, {} as any));

    expect(router.createUrlTree).toHaveBeenCalledWith(['/']);
    expect(result).toBe('/' as any);
  });
});
