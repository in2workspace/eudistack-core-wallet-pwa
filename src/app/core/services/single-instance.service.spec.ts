import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SingleInstanceService } from './single-instance.service';
import { AuthService } from './auth.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

// ---------------------------------------------------------------------------
// Minimal BroadcastChannel mock
// ---------------------------------------------------------------------------
class BroadcastChannelMock {
  readonly name: string;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  private static instances: BroadcastChannelMock[] = [];

  constructor(name: string) {
    this.name = name;
    BroadcastChannelMock.instances.push(this);
  }

  postMessage(data: unknown): void {
    BroadcastChannelMock.instances
      .filter(i => i !== this && i.name === this.name)
      .forEach(i => i.onmessage?.({ data } as MessageEvent));
  }

  close(): void {
    BroadcastChannelMock.instances = BroadcastChannelMock.instances.filter(i => i !== this);
  }

  static reset(): void {
    BroadcastChannelMock.instances = [];
  }
}

describe('SingleInstanceService', () => {
  let service: SingleInstanceService;
  let routerMock: jest.Mocked<Pick<Router, 'navigateByUrl'>>;
  let authServiceMock: jest.Mocked<Pick<AuthService, 'isLoggedIn' | 'dispose'>>;
  let baseQuerySpy: jest.SpyInstance;

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = BroadcastChannelMock;
  });

  beforeEach(() => {
    BroadcastChannelMock.reset();
    sessionStorage.clear();

    routerMock = { navigateByUrl: jest.fn() } as unknown as jest.Mocked<Pick<Router, 'navigateByUrl'>>;
    authServiceMock = {
      isLoggedIn: jest.fn().mockReturnValue(true),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuthService, 'isLoggedIn' | 'dispose'>>;

    // Simulate <base href="/wallet/"> in the document
    baseQuerySpy = jest.spyOn(document, 'querySelector').mockImplementation((selector) => {
      if (selector === 'base') {
        return { getAttribute: (attr: string) => attr === 'href' ? '/wallet/' : null } as unknown as Element;
      }
      return null;
    });

    TestBed.configureTestingModule({
      providers: [
        SingleInstanceService,
        { provide: Router, useValue: routerMock },
        { provide: AuthService, useValue: authServiceMock },
      ],
    });

    service = TestBed.inject(SingleInstanceService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
  });

  // -------------------------------------------------------------------------
  // stripBase
  // -------------------------------------------------------------------------
  describe('stripBase', () => {
    it('strips base href on path boundary', () => {
      const result = (SingleInstanceService as any).stripBase('/wallet/protocol/callback?code=abc');
      expect(result).toBe('/protocol/callback?code=abc');
    });

    it('strips base when followed by query string directly', () => {
      const result = (SingleInstanceService as any).stripBase('/wallet?foo=bar');
      expect(result).toBe('/?foo=bar');
    });

    it('does NOT strip when base only partially matches a segment', () => {
      const result = (SingleInstanceService as any).stripBase('/walletish/protocol/callback');
      expect(result).toBe('/walletish/protocol/callback');
    });

    it('returns "/" when url equals the base exactly', () => {
      const result = (SingleInstanceService as any).stripBase('/wallet');
      expect(result).toBe('/');
    });

    it('returns "/" when url equals base with trailing slash', () => {
      baseQuerySpy.mockImplementation((selector) => {
        if (selector === 'base') {
          return { getAttribute: (attr: string) => attr === 'href' ? '/wallet/' : null } as unknown as Element;
        }
        return null;
      });
      const result = (SingleInstanceService as any).stripBase('/wallet/');
      expect(result).toBe('/');
    });
  });

  // -------------------------------------------------------------------------
  // handleMessage — leader deep-link forwarding
  // -------------------------------------------------------------------------
  describe('handleMessage NAVIGATE (leader)', () => {
    beforeEach(() => {
      (service as any).isLeader = true;
      // Give the service a channel so it can respond to NEW_TAB
      (service as any).channel = new BroadcastChannelMock('wallet-single-instance');
    });

    it('navigates to deep-link /protocol/ when logged in', () => {
      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/protocol/callback?code=abc',
      });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/protocol/callback?code=abc');
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
    });

    it('queues /protocol/ deep-link to sessionStorage when not logged in', () => {
      authServiceMock.isLoggedIn.mockReturnValue(false);

      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/protocol/callback?code=abc',
      });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/protocol/callback?code=abc');
    });

    it('navigates to /tabs/vc-selector deep-link when logged in', () => {
      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/tabs/vc-selector?authorization_request=openid4vp%3A%2F%2F',
      });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
        '/tabs/vc-selector?authorization_request=openid4vp%3A%2F%2F'
      );
    });

    it('does NOT navigate for non-deep-link routes', () => {
      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/tabs/credentials',
      });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
    });

    it('does NOT navigate when not the leader', () => {
      (service as any).isLeader = false;

      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/protocol/callback?code=abc',
      });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    });

    it('ignores own-tab messages', () => {
      const ownTabId = (service as any).tabId;

      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: ownTabId,
        url: '/wallet/protocol/callback?code=abc',
      });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // renderDuplicateTabMessage — authService.dispose() is always called
  // -------------------------------------------------------------------------
  describe('renderDuplicateTabMessage (follower cleanup)', () => {
    it('calls authService.dispose() on duplicate non-deep-link tab', () => {
      (service as any).renderDuplicateTabMessage(false);
      expect(authServiceMock.dispose).toHaveBeenCalled();
    });

    it('calls authService.dispose() on duplicate deep-link tab', () => {
      (service as any).renderDuplicateTabMessage(true);
      expect(authServiceMock.dispose).toHaveBeenCalled();
    });

    it('nulls the channel after dispose', () => {
      (service as any).channel = new BroadcastChannelMock('wallet-single-instance');
      (service as any).renderDuplicateTabMessage(false);
      expect((service as any).channel).toBeNull();
    });
  });
});
