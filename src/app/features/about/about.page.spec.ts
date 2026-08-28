import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterLink, RouterModule } from '@angular/router';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { AboutPage } from './about.page';
import { SupportChannelService } from './services/support-channel.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';

const translateServiceMock = {
  currentLang: 'es',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  use: jest.fn(),
  get: jest.fn().mockImplementation((key: string): Observable<string> => of(key)),
  instant: jest.fn().mockImplementation((key: string) => key),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
};

function makeSupportChannelStub(overrides: { helpCenterUrl?: string | null } = {}) {
  // NOTE: 'helpCenterUrl' in overrides — not `?? default` — because a caller passing
  // { helpCenterUrl: null } explicitly (EC-02) must NOT be silently replaced by `??`,
  // which treats null the same as undefined.
  const helpCenterUrl = 'helpCenterUrl' in overrides ? overrides.helpCenterUrl! : 'https://docs.eudistack.net';
  return {
    channels: jest.fn().mockReturnValue({
      email: 'support@eudistack.com',
      helpCenterUrl,
      issueTrackerUrl: 'https://github.com/in2workspace/eudistack-core-wallet-pwa/issues/new',
    }),
    buildSupportMailto: jest.fn().mockReturnValue('mailto:support@eudistack.com?subject=x&body=y'),
    buildIssueUrl: jest.fn().mockReturnValue('https://github.com/in2workspace/eudistack-core-wallet-pwa/issues/new?title=x'),
  };
}

function makeModalControllerStub(dismissResult: { role: string } = { role: 'cancel' }) {
  return {
    create: jest.fn().mockResolvedValue({
      present: jest.fn().mockResolvedValue(undefined),
      onWillDismiss: jest.fn().mockResolvedValue(dismissResult),
    }),
  };
}

/** Creates a WalletDiscoveryService stub that returns the given mode synchronously. */
function makeDiscoveryStub(resolvedMode: 'browser' | 'server' = 'browser'): Partial<WalletDiscoveryService> {
  return { mode: () => resolvedMode };
}

async function createFixture(
  supportStub: ReturnType<typeof makeSupportChannelStub>,
  modalCtrlMock: ReturnType<typeof makeModalControllerStub>,
  walletMode: 'browser' | 'server' = 'browser'
): Promise<ComponentFixture<AboutPage>> {
  // AboutPage's own standalone `imports: [IonicModule, ...]` resolves a fresh ModalController
  // scoped to the component's own injector, shadowing a TestBed-level provider override (same
  // issue documented in activity.page.spec.ts). Overriding the component's own providers ensures
  // the mock wins — otherwise `inject(ModalController)` resolves the REAL Ionic controller, whose
  // `create()` never resolves in jsdom and hangs the test until the Jest timeout.
  TestBed.overrideComponent(AboutPage, {
    add: { providers: [{ provide: ModalController, useValue: modalCtrlMock }] },
  });

  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [AboutPage, IonicModule.forRoot(), RouterModule.forRoot([]), TranslateModule.forRoot()],
    providers: [
      { provide: SupportChannelService, useValue: supportStub },
      { provide: ModalController, useValue: modalCtrlMock },
      { provide: TranslateService, useValue: translateServiceMock },
      { provide: WalletDiscoveryService, useValue: makeDiscoveryStub(walletMode) },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AboutPage);
  fixture.detectChanges();
  return fixture;
}

describe('AboutPage', () => {
  let modalCtrlMock: ReturnType<typeof makeModalControllerStub>;
  let supportStub: ReturnType<typeof makeSupportChannelStub>;

  beforeEach(() => {
    supportStub = makeSupportChannelStub();
    modalCtrlMock = makeModalControllerStub();
    jest.spyOn(window, 'open').mockImplementation(() => null);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('creates the component and exposes BUILD_INFO for the version/build panel (AC-02)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);
    const component = fixture.componentInstance;

    expect(component).toBeTruthy();
    expect(component.buildInfo.version).toBeTruthy();
    expect(component.buildInfo.buildId).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain(component.buildInfo.version);
    expect(fixture.nativeElement.textContent).toContain(component.buildInfo.buildId);
  });

  it('renders the three legal documents plus the licenses item (AC-03)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    // 3 legal docs + licenses = 4 routed items in the legal block.
    const routerLinks = fixture.debugElement
      .queryAll(By.directive(RouterLink))
      .map((de) => de.injector.get(RouterLink).urlTree?.toString());

    expect(routerLinks).toEqual([
      '/tabs/about/legal/terms-of-service',
      '/tabs/about/legal/privacy-policy',
      '/tabs/about/legal/legal-notice',
      '/tabs/about/licenses',
    ]);
  });

  it('renders the help center item only when a helpCenterUrl is resolved (AC-06)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);
    const items = fixture.debugElement.queryAll(By.css('ion-item'));
    const helpCenterItem = items.find((el) => el.nativeElement.href === 'https://docs.eudistack.net');

    expect(helpCenterItem).toBeTruthy();
    expect(helpCenterItem!.nativeElement.getAttribute('target')).toBe('_blank');
    expect(helpCenterItem!.nativeElement.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('does not render the help center item when helpCenterUrl is null (EC-02)', async () => {
    supportStub = makeSupportChannelStub({ helpCenterUrl: null });
    const fixture = await createFixture(supportStub, modalCtrlMock);

    // routerLink items also end up with a native `href` (RouterLink reflects attr.href
    // regardless of host tag), so match on the specific help-center URL, not mere truthiness.
    const items = fixture.debugElement.queryAll(By.css('ion-item'));
    const helpCenterItem = items.find((el) => el.nativeElement.href === 'https://docs.eudistack.net');
    expect(helpCenterItem).toBeUndefined();

    // The rest of the legal + support items remain present.
    expect(fixture.debugElement.queryAll(By.directive(RouterLink)).length).toBe(4);
  });

  it('builds the mailto href from SupportChannelService, no PII (AC-07)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);
    const emailAnchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a.about-email-link');

    expect(emailAnchor.getAttribute('href')).toBe('mailto:support@eudistack.com?subject=x&body=y');
  });

  it('copies the visible support email address on demand (EC-04)', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const fixture = await createFixture(supportStub, modalCtrlMock);
    await fixture.componentInstance.copySupportEmail();

    expect(writeText).toHaveBeenCalledWith('support@eudistack.com');
  });

  describe('AC-08/AC-09 — report issue PII warning', () => {
    it('shows the warning before any redirection and does NOT open a tab until confirmed', async () => {
      modalCtrlMock = makeModalControllerStub({ role: 'confirm' });
      const fixture = await createFixture(supportStub, modalCtrlMock);

      await fixture.componentInstance.reportIssue();

      expect(modalCtrlMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          componentProps: expect.objectContaining({ titleKey: 'about.pii-warning.title' }),
        })
      );
      expect(window.open).toHaveBeenCalledTimes(1);
      expect(window.open).toHaveBeenCalledWith(
        'https://github.com/in2workspace/eudistack-core-wallet-pwa/issues/new?title=x',
        '_blank',
        'noopener,noreferrer'
      );
    });

    it('cancelling the warning opens nothing (AC-09)', async () => {
      modalCtrlMock = makeModalControllerStub({ role: 'cancel' });
      const fixture = await createFixture(supportStub, modalCtrlMock);

      await fixture.componentInstance.reportIssue();

      expect(window.open).not.toHaveBeenCalled();
    });

    it('does not open a tab when confirmed while offline, and informs instead (EC-03)', async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      jest.spyOn(window, 'alert').mockImplementation(() => undefined);
      modalCtrlMock = makeModalControllerStub({ role: 'confirm' });

      const fixture = await createFixture(supportStub, modalCtrlMock);
      await fixture.componentInstance.reportIssue();

      expect(window.open).not.toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('about.support.offline');
    });
  });

  describe('AC-10 — wallet-mode is displayed, never used to hide/disable a capability', () => {
    it('shows the EUDIW badge/key in browser mode', async () => {
      const fixture = await createFixture(supportStub, modalCtrlMock, 'browser');

      expect(fixture.componentInstance.isServerMode).toBe(false);
      expect(fixture.componentInstance.walletModeKey).toBe('settings.wallet-mode-eudiw');
      expect(fixture.nativeElement.textContent).toContain('settings.wallet-mode-eudiw');
    });

    it('shows the Business badge/key in server (EBW) mode', async () => {
      const fixture = await createFixture(supportStub, modalCtrlMock, 'server');

      expect(fixture.componentInstance.isServerMode).toBe(true);
      expect(fixture.componentInstance.walletModeKey).toBe('settings.wallet-mode-business');
      expect(fixture.nativeElement.textContent).toContain('settings.wallet-mode-business');
    });

    it('renders the identical set of legal/support items in both modes (AC-10)', async () => {
      const browserFixture = await createFixture(supportStub, modalCtrlMock, 'browser');
      const browserLinks = browserFixture.debugElement
        .queryAll(By.directive(RouterLink))
        .map((de) => de.injector.get(RouterLink).urlTree?.toString());

      TestBed.resetTestingModule();
      supportStub = makeSupportChannelStub();
      const serverFixture = await createFixture(supportStub, modalCtrlMock, 'server');
      const serverLinks = serverFixture.debugElement
        .queryAll(By.directive(RouterLink))
        .map((de) => de.injector.get(RouterLink).urlTree?.toString());

      expect(serverLinks).toEqual(browserLinks);
    });
  });
});
