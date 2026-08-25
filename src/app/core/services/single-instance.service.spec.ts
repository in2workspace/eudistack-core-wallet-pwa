import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SingleInstanceService, RelayTransport } from './single-instance.service';
import { AuthService } from './auth.service';
import { InstanceGroupService } from './instance-group.service';
import { InstanceGroup } from '../models/instance-group.model';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

const SINGLE_INSTANCE_I18N: Record<string, string> = {
  'single-instance.type-window': 'ventana',
  'single-instance.type-tab': 'pestaña',
  'single-instance.title-deep-link': 'Credencial enviada a EUDI Wallet',
  'single-instance.title-already-open': 'EUDI Wallet ya está abierto',
  'single-instance.subtitle-deep-link': 'La credencial se ha enviado a la {{type}} activa de EUDI Wallet. Puedes cerrar esta {{type}}.',
  'single-instance.subtitle-already-open': 'Ya tienes EUDI Wallet abierto en otra {{type}}. Puedes cerrar esta.',
  'single-instance.hint-standalone': 'Vuelve a la otra ventana de EUDI Wallet.',
  'single-instance.hint-tab': 'Usa Ctrl+Tab para volver a la pestaña activa.',
  'single-instance.close-fallback-standalone': 'Cierra esta ventana manualmente',
  'single-instance.close-fallback-tab': 'Cierra esta pestaña con Ctrl+W (⌘+W en Mac)',
  'single-instance.close-button': 'Cerrar esta {{type}}',
};

function setStandaloneMedia(value: boolean): void {
  (window as any).matchMedia = (query: string) => ({
    matches: value && query.includes('standalone'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}

function setNavigatorStandalone(value: boolean | undefined): void {
  Object.defineProperty(navigator, 'standalone', { value, configurable: true });
}

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
  let translateServiceMock: jest.Mocked<Pick<TranslateService, 'instant'>>;
  let instanceGroupServiceMock: jest.Mocked<Pick<InstanceGroupService, 'resolveGroupForOrigin'>>;
  let baseQuerySpy: jest.SpyInstance;

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = BroadcastChannelMock;
    jest.spyOn(window, 'focus').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    BroadcastChannelMock.reset();
    sessionStorage.clear();

    routerMock = { navigateByUrl: jest.fn() } as unknown as jest.Mocked<Pick<Router, 'navigateByUrl'>>;
    authServiceMock = {
      isLoggedIn: jest.fn().mockReturnValue(true),
      dispose: jest.fn(),
    } as unknown as jest.Mocked<Pick<AuthService, 'isLoggedIn' | 'dispose'>>;
    translateServiceMock = {
      instant: jest.fn().mockImplementation((key: string, params?: Record<string, string>) => {
        let text = SINGLE_INSTANCE_I18N[key] ?? key;
        if (params) {
          text = text.replace(/\{\{(\w+)\}\}/g, (_: string, k: string) => params[k] ?? '');
        }
        return text;
      }),
    } as unknown as jest.Mocked<Pick<TranslateService, 'instant'>>;
    // Ungrouped by default — matches every real origin except the DOME STG aliases.
    instanceGroupServiceMock = {
      resolveGroupForOrigin: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<Pick<InstanceGroupService, 'resolveGroupForOrigin'>>;

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
        { provide: TranslateService, useValue: translateServiceMock },
        { provide: InstanceGroupService, useValue: instanceGroupServiceMock },
      ],
    });

    service = TestBed.inject(SingleInstanceService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    sessionStorage.clear();
    setStandaloneMedia(false);
    setNavigatorStandalone(undefined);
  });

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

    it('navigates to /tabs/credentials deep-link when logged in', () => {
      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/tabs/credentials?credentialOfferUri=openid-credential-offer%3A%2F%2F',
      });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
        '/tabs/credentials?credentialOfferUri=openid-credential-offer%3A%2F%2F'
      );
    });

    it('queues /tabs/credentials deep-link to sessionStorage when not logged in', () => {
      authServiceMock.isLoggedIn.mockReturnValue(false);

      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/tabs/credentials?credentialOfferUri=openid-credential-offer%3A%2F%2F',
      });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(
        '/tabs/credentials?credentialOfferUri=openid-credential-offer%3A%2F%2F'
      );
    });

    it('does NOT navigate for non-deep-link routes', () => {
      (service as any).handleMessage({
        type: 'NAVIGATE',
        tabId: 'other-tab',
        url: '/wallet/home',
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

    it('renders the duplicate-tab message UI in browser tab mode (non-standalone)', () => {
      setStandaloneMedia(false);

      (service as any).renderDuplicateTabMessage(false);

      expect(document.body.innerHTML).toContain('__wallet_close_btn');
      expect(document.body.innerHTML).toContain('EUDI Wallet ya está abierto');
      expect(document.body.innerHTML).toContain('pestaña');
      expect(document.body.innerHTML).toContain('Ctrl+Tab');
    });

    it('renders the duplicate-tab message UI in standalone (PWA installed) mode', () => {
      setStandaloneMedia(true);

      (service as any).renderDuplicateTabMessage(false);

      expect(document.body.innerHTML).toContain('__wallet_close_btn');
      expect(document.body.innerHTML).toContain('EUDI Wallet ya está abierto');
      expect(document.body.innerHTML).toContain('ventana');
      expect(document.body.innerHTML).not.toContain('Ctrl+Tab');
    });

    it('renders deep-link variant in standalone mode', () => {
      setStandaloneMedia(true);

      (service as any).renderDuplicateTabMessage(true);

      expect(document.body.innerHTML).toContain('__wallet_close_btn');
      expect(document.body.innerHTML).toContain('Credencial enviada a EUDI Wallet');
      expect(document.body.innerHTML).toContain('ventana');
    });

    it('calls authService.dispose() in standalone mode (no silent close bypass)', () => {
      setStandaloneMedia(true);

      (service as any).renderDuplicateTabMessage(false);

      expect(authServiceMock.dispose).toHaveBeenCalled();
    });

    it('renders standalone copy when navigator.standalone is true (iOS Safari PWA)', () => {
      setStandaloneMedia(false);
      setNavigatorStandalone(true);

      (service as any).renderDuplicateTabMessage(false);

      expect(document.body.innerHTML).toContain('ventana');
      expect(document.body.innerHTML).not.toContain('Ctrl+Tab');
    });
  });

  describe('elect() — transport selection', () => {
    const domeStgGroup: InstanceGroup = {
      id: 'dome-stg',
      brokerUrl: 'https://dome.stg.eudistack.net/wallet/assets/instance-broker.html',
      memberOrigins: [
        'https://dome.stg.eudistack.net',
        'https://wallet.dome-marketplace-lcl.org',
        'https://wallet.dome-marketplace-sbx.org',
      ],
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('uses the same-origin BroadcastChannel directly when the origin belongs to no instance group', async () => {
      // Arrange
      instanceGroupServiceMock.resolveGroupForOrigin.mockResolvedValue(null);
      const connectSpy = jest.spyOn(RelayTransport, 'connect');

      // Act
      const isLeader = await service.elect();

      // Assert
      expect(connectSpy).not.toHaveBeenCalled();
      expect(isLeader).toBe(true);
      expect((service as any).channel).toBeInstanceOf(BroadcastChannelMock);
    });

    it('routes election through the cross-origin relay when the origin belongs to an instance group', async () => {
      // Arrange
      instanceGroupServiceMock.resolveGroupForOrigin.mockResolvedValue(domeStgGroup);
      const fakeRelay = { postMessage: jest.fn(), onmessage: null, close: jest.fn() };
      const connectSpy = jest.spyOn(RelayTransport, 'connect').mockResolvedValue(fakeRelay as any);

      // Act
      const isLeader = await service.elect();

      // Assert
      expect(connectSpy).toHaveBeenCalledWith(domeStgGroup.brokerUrl, 400);
      expect(fakeRelay.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'NEW_TAB' }));
      expect(isLeader).toBe(true);
    });

    it('detects a leader reachable only through the relay (cross-origin duplicate tab)', async () => {
      // Arrange
      instanceGroupServiceMock.resolveGroupForOrigin.mockResolvedValue(domeStgGroup);
      const fakeRelay = {
        postMessage: jest.fn((msg: { type: string }) => {
          if (msg.type === 'NEW_TAB') {
            // Delivered on a later tick, like a real cross-context postMessage/BroadcastChannel
            // round-trip — the election code relies on that asynchrony (see the TODO in elect())
            // to have its LEADER_ACK listener installed before any reply can arrive.
            setTimeout(() => {
              fakeRelay.onmessage?.({ data: { type: 'LEADER_ACK', tabId: 'other-origin-leader' } } as MessageEvent);
            }, 0);
          }
        }),
        onmessage: null as ((ev: MessageEvent) => void) | null,
        close: jest.fn(),
      };
      jest.spyOn(RelayTransport, 'connect').mockResolvedValue(fakeRelay as any);

      // Act
      const isLeader = await service.elect();

      // Assert
      expect(isLeader).toBe(false);
      expect(document.body.innerHTML).toContain('EUDI Wallet ya está abierto');
      expect(fakeRelay.close).toHaveBeenCalled();
    });

    it('logs a warning and falls back to the same-origin BroadcastChannel when the relay does not connect in time', async () => {
      // Arrange
      instanceGroupServiceMock.resolveGroupForOrigin.mockResolvedValue(domeStgGroup);
      jest.spyOn(RelayTransport, 'connect').mockResolvedValue(null);
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      // Act
      const isLeader = await service.elect();

      // Assert
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('dome-stg'),
        expect.stringContaining('dome.stg.eudistack.net'),
      );
      expect(isLeader).toBe(true);
      expect((service as any).channel).toBeInstanceOf(BroadcastChannelMock);
    });
  });
});
