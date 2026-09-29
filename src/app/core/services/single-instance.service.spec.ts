import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { SingleInstanceService } from './single-instance.service';
import { AuthService } from './auth.service';
import { PENDING_DEEP_LINK_KEY } from '../constants/deep-link.constants';

const SINGLE_INSTANCE_I18N: Record<string, string> = {
  'single-instance.type-window': 'ventana',
  'single-instance.type-tab': 'pestaña',
  'single-instance.title-deep-link': 'Credencial enviada a EUDI Wallet',
  'single-instance.title-already-open': 'EUDI Wallet ya está abierto',
  'single-instance.subtitle-deep-link': 'La credencial se ha enviado a la {{type}} activa de EUDI Wallet. Puedes cerrar esta {{type}}.',
  'single-instance.subtitle-already-open': 'Ya tienes EUDI Wallet abierto en otra {{type}}. Puedes cerrar esta.',
  'single-instance.title-offer-ready': 'Credencial lista para aprobar',
  'single-instance.subtitle-offer-ready': 'La credencial te espera en la {{type}} de EUDI Wallet que ya tenías abierta. Ve a ella para aprobarla.',
  'single-instance.title-offer-pending-login': 'Inicia sesión para continuar',
  'single-instance.subtitle-offer-pending-login': 'La credencial se aplicará cuando inicies sesión en la {{type}} de EUDI Wallet que ya tenías abierta. Ve a ella para continuar.',
  'single-instance.hint-go-to-tab': 'Cambia a la pestaña de EUDI Wallet desde la barra de pestañas de tu navegador.',
  'single-instance.hint-go-to-window': 'Cambia a la ventana de la aplicación EUDI Wallet.',
  'single-instance.tab-title-pending-offer': '(1) Credencial pendiente',
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

type SentMessage = Record<string, unknown>;

interface FakeLeaderOptions {
  ackOutcome: 'navigated' | 'pending-login' | null;
  leaderStandalone?: boolean;
  replyTo?: string;
}

/**
 * Stands in for an existing leader tab. Replies asynchronously, like a real tab, because
 * elect() only listens for LEADER_ACK after it has posted NEW_TAB.
 */
function installFakeLeader(received: SentMessage[], options: FakeLeaderOptions): void {
  const leaderChannel = new BroadcastChannelMock('wallet-single-instance');
  leaderChannel.onmessage = (ev: MessageEvent) => {
    const msg = ev.data as SentMessage;
    received.push(msg);
    Promise.resolve().then(() => {
      if (msg['type'] === 'NEW_TAB') {
        leaderChannel.postMessage({ type: 'LEADER_ACK', tabId: 'leader-tab' });
      }
      if (msg['type'] === 'NAVIGATE' && options.ackOutcome) {
        leaderChannel.postMessage({
          type: 'NAVIGATE_ACK',
          tabId: 'leader-tab',
          replyTo: options.replyTo ?? msg['tabId'],
          outcome: options.ackOutcome,
          leaderStandalone: options.leaderStandalone ?? false,
        });
      }
    });
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('SingleInstanceService', () => {
  let service: SingleInstanceService;
  let routerMock: jest.Mocked<Pick<Router, 'navigateByUrl'>>;
  let authServiceMock: jest.Mocked<Pick<AuthService, 'isLoggedIn' | 'dispose'>>;
  let translateServiceMock: jest.Mocked<Pick<TranslateService, 'instant'>>;
  let baseQuerySpy: jest.SpyInstance;

  beforeAll(() => {
    (globalThis as any).BroadcastChannel = BroadcastChannelMock;
  });

  beforeEach(() => {
    jest.spyOn(window, 'focus').mockImplementation(() => undefined);
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

  describe('handleMessage NAVIGATE (leader acknowledgement)', () => {
    const OFFER_URL = '/wallet/protocol/callback?credential_offer_uri=https%3A%2F%2Fissuer.local%2Foffer%2F1';
    let received: SentMessage[];

    beforeEach(() => {
      (service as any).isLeader = true;
      (service as any).channel = new BroadcastChannelMock('wallet-single-instance');
      received = [];
      const followerChannel = new BroadcastChannelMock('wallet-single-instance');
      followerChannel.onmessage = (ev: MessageEvent) => received.push(ev.data as SentMessage);
    });

    it('acknowledges a credential offer as navigated when logged in', () => {
      (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

      expect(received).toEqual([{
        type: 'NAVIGATE_ACK',
        tabId: (service as any).tabId,
        replyTo: 'follower-tab',
        outcome: 'navigated',
        leaderStandalone: false,
      }]);
      expect(routerMock.navigateByUrl).toHaveBeenCalledWith(
        '/protocol/callback?credential_offer_uri=https%3A%2F%2Fissuer.local%2Foffer%2F1'
      );
    });

    it('acknowledges a credential offer as pending-login when not logged in', () => {
      authServiceMock.isLoggedIn.mockReturnValue(false);

      (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({ type: 'NAVIGATE_ACK', replyTo: 'follower-tab', outcome: 'pending-login' });
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe(
        '/protocol/callback?credential_offer_uri=https%3A%2F%2Fissuer.local%2Foffer%2F1'
      );
    });

    it('reports the leader as standalone when running as an installed PWA', () => {
      setStandaloneMedia(true);

      (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

      expect(received[0]).toMatchObject({ leaderStandalone: true });
    });

    it('does NOT acknowledge non-deep-link routes', () => {
      (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: '/wallet/home' });

      expect(received).toHaveLength(0);
    });

    it('does NOT acknowledge when not the leader', () => {
      (service as any).isLeader = false;

      (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

      expect(received).toHaveLength(0);
    });

    describe('pending offer tab title', () => {
      const setDocumentHidden = (hidden: boolean): void => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
        document.dispatchEvent(new Event('visibilitychange'));
      };

      beforeEach(() => {
        document.title = 'EUDI Wallet';
      });

      afterEach(() => {
        setDocumentHidden(false);
        delete (document as any).hidden;
      });

      it('prefixes the title when the offer arrives while the tab is hidden', () => {
        setDocumentHidden(true);

        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

        expect(document.title).toBe('(1) Credencial pendiente · EUDI Wallet');
      });

      it('restores the title once the tab becomes visible again', () => {
        setDocumentHidden(true);
        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

        setDocumentHidden(false);

        expect(document.title).toBe('EUDI Wallet');
      });

      it('does NOT stack the prefix when a second offer arrives while still hidden', () => {
        setDocumentHidden(true);

        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });
        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'other-tab', url: OFFER_URL });
        setDocumentHidden(false);

        expect(document.title).toBe('EUDI Wallet');
      });

      it('flags the title also when the offer is queued until login', () => {
        authServiceMock.isLoggedIn.mockReturnValue(false);
        setDocumentHidden(true);

        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

        expect(document.title).toBe('(1) Credencial pendiente · EUDI Wallet');
      });

      it('does NOT touch the title when the tab is already visible', () => {
        setDocumentHidden(false);

        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: OFFER_URL });

        expect(document.title).toBe('EUDI Wallet');
      });

      it('does NOT touch the title for non-deep-link routes', () => {
        setDocumentHidden(true);

        (service as any).handleMessage({ type: 'NAVIGATE', tabId: 'follower-tab', url: '/wallet/home' });

        expect(document.title).toBe('EUDI Wallet');
      });
    });
  });

  describe('consumeLaunchQueue', () => {
    let consumer: (params: { targetURL?: string }) => void;

    beforeEach(() => {
      (window as any).launchQueue = {
        setConsumer: jest.fn((cb: (params: { targetURL?: string }) => void) => { consumer = cb; }),
      };
      service.consumeLaunchQueue();
    });

    afterEach(() => {
      delete (window as any).launchQueue;
    });

    it('navigates to the launch target when logged in', () => {
      consumer({ targetURL: 'https://wallet.local/wallet/tabs/credentials?credentialOfferUri=abc' });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials?credentialOfferUri=abc');
    });

    it('queues the launch target when not logged in', () => {
      authServiceMock.isLoggedIn.mockReturnValue(false);

      consumer({ targetURL: 'https://wallet.local/wallet/tabs/credentials?credentialOfferUri=abc' });

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBe('/tabs/credentials?credentialOfferUri=abc');
    });

    it('keeps navigating for launch targets that are not deep links', () => {
      consumer({ targetURL: 'https://wallet.local/wallet/' });

      expect(routerMock.navigateByUrl).toHaveBeenCalledWith('/');
    });

    it('ignores launch params without a target URL', () => {
      consumer({});

      expect(routerMock.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('follower hand-off to the leader', () => {
    const OFFER_PATH = '/wallet/protocol/callback?credential_offer_uri=abc';
    let sentToLeader: SentMessage[];
    let closeSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.useFakeTimers();
      closeSpy = jest.spyOn(window, 'close').mockImplementation(() => undefined);
      sentToLeader = [];
    });

    afterEach(() => {
      jest.useRealTimers();
      window.history.replaceState({}, '', '/');
    });

    it('resolves false, sends NAVIGATE and tells the user where to approve when the leader navigated', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'navigated' });

      const isLeader = await service.elect();
      await flushMicrotasks();

      expect(isLeader).toBe(false);
      expect(sentToLeader).toContainEqual({ type: 'NAVIGATE', tabId: (service as any).tabId, url: OFFER_PATH });
      expect(document.body.innerHTML).toContain('Credencial lista para aprobar');
      expect(document.body.innerHTML).toContain('Cambia a la pestaña de EUDI Wallet');
    });

    it('does NOT close the tab, so the user is never left on the mail client with no explanation', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'navigated' });

      await service.elect();
      await flushMicrotasks();

      expect(closeSpy).not.toHaveBeenCalled();
    });

    it('sets the follower tab title to the message headline', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'navigated' });

      await service.elect();
      await flushMicrotasks();

      expect(document.title).toBe('Credencial lista para aprobar');
    });

    it('asks to sign in when the leader queued the offer', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'pending-login' });

      await service.elect();
      await flushMicrotasks();

      expect(closeSpy).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toContain('Inicia sesión para continuar');
    });

    it('falls back to the offer-sent message when the leader never acknowledges', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: null });

      await service.elect();
      await flushMicrotasks();
      jest.advanceTimersByTime(500);
      await flushMicrotasks();

      expect(closeSpy).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toContain('Credencial enviada a EUDI Wallet');
    });

    it('ignores an acknowledgement addressed to another follower', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'navigated', replyTo: 'other-follower-tab' });

      await service.elect();
      await flushMicrotasks();
      jest.advanceTimersByTime(500);
      await flushMicrotasks();

      expect(closeSpy).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toContain('Credencial enviada a EUDI Wallet');
    });

    it('describes the leader as a window when it runs as an installed PWA', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: 'navigated', leaderStandalone: true });

      await service.elect();
      await flushMicrotasks();

      expect(document.body.innerHTML).toContain('ventana');
      expect(document.body.innerHTML).toContain('Cambia a la ventana de la aplicación EUDI Wallet');
      expect(document.body.innerHTML).not.toContain('Ctrl+Tab');
    });

    it('does NOT wait for an acknowledgement on non-deep-link routes', async () => {
      window.history.pushState({}, '', '/wallet/');
      installFakeLeader(sentToLeader, { ackOutcome: null });

      await service.elect();
      await flushMicrotasks();

      expect(sentToLeader).toContainEqual({ type: 'NAVIGATE', tabId: (service as any).tabId, url: '/wallet/' });
      expect(closeSpy).not.toHaveBeenCalled();
      expect(document.body.innerHTML).toContain('EUDI Wallet ya está abierto');
    });

    it('calls authService.dispose() before waiting for the leader on a deep link', async () => {
      window.history.pushState({}, '', OFFER_PATH);
      installFakeLeader(sentToLeader, { ackOutcome: null });

      await service.elect();

      expect(authServiceMock.dispose).toHaveBeenCalled();
      expect(document.body.innerHTML).not.toContain('Credencial enviada a EUDI Wallet');
    });

    it('calls authService.dispose() on a duplicate non-deep-link tab', async () => {
      window.history.pushState({}, '', '/wallet/');
      installFakeLeader(sentToLeader, { ackOutcome: null });

      await service.elect();
      await flushMicrotasks();

      expect(authServiceMock.dispose).toHaveBeenCalled();
    });

    it('calls authService.dispose() in standalone mode (no silent close bypass)', async () => {
      setStandaloneMedia(true);
      window.history.pushState({}, '', '/wallet/');
      installFakeLeader(sentToLeader, { ackOutcome: null });

      await service.elect();
      await flushMicrotasks();

      expect(authServiceMock.dispose).toHaveBeenCalled();
    });
  });

  describe('renderDuplicateTabMessage (follower cleanup)', () => {
    it('nulls the channel after rendering', () => {
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

    it('renders standalone copy when navigator.standalone is true (iOS Safari PWA)', () => {
      setStandaloneMedia(false);
      setNavigatorStandalone(true);

      (service as any).renderDuplicateTabMessage(false);

      expect(document.body.innerHTML).toContain('ventana');
      expect(document.body.innerHTML).not.toContain('Ctrl+Tab');
    });

    it('renders the offer-ready variant telling the user where to approve it', () => {
      (service as any).renderDuplicateTabMessage(true, { outcome: 'navigated', leaderStandalone: false });

      expect(document.body.innerHTML).toContain('Credencial lista para aprobar');
      expect(document.body.innerHTML).toContain('pestaña de EUDI Wallet que ya tenías abierta');
      expect(document.body.innerHTML).not.toContain('Ctrl+Tab');
    });

    it('renders the pending-login variant telling the user to sign in on the leader', () => {
      (service as any).renderDuplicateTabMessage(true, { outcome: 'pending-login', leaderStandalone: false });

      expect(document.body.innerHTML).toContain('Inicia sesión para continuar');
    });

    it('uses the leader display mode over its own when they differ', () => {
      setStandaloneMedia(false);

      (service as any).renderDuplicateTabMessage(true, { outcome: 'navigated', leaderStandalone: true });

      expect(document.body.innerHTML).toContain('ventana de EUDI Wallet que ya tenías abierta');
      expect(document.body.innerHTML).toContain('Cambia a la ventana de la aplicación EUDI Wallet');
    });
  });
});
