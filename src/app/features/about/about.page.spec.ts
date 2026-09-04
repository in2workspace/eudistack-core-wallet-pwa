import { TestBed, ComponentFixture } from '@angular/core/testing';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';
import { AboutPage } from './about.page';
import { SupportChannelService } from './services/support-channel.service';
import { LegalContentService } from './services/legal-content.service';
import { OssLicenseService } from './services/oss-license.service';
import { LegalContentResult } from './models/legal-document.model';
import { ThemeService } from 'src/app/core/services/theme.service';
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

const READY_DOCUMENT: LegalContentResult = {
  status: 'ready',
  content: {
    docId: 'terms-of-service',
    lang: 'es',
    html: '<p>Contenido legal</p>',
    isFallbackLanguage: false,
  },
};

let legalResult: LegalContentResult = READY_DOCUMENT;
let legalContentStub: { load: jest.Mock };
let ossLicenseStub: { load: jest.Mock };

/** Headers of the collapsible rows, in render order. */
function panelHeaders(fixture: ComponentFixture<AboutPage>): HTMLButtonElement[] {
  return Array.from(fixture.nativeElement.querySelectorAll('.about-row__header'));
}

function expandPanel(fixture: ComponentFixture<AboutPage>, index: number): void {
  panelHeaders(fixture)[index].dispatchEvent(new MouseEvent('click'));
  fixture.detectChanges();
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
      { provide: LegalContentService, useValue: legalContentStub },
      { provide: OssLicenseService, useValue: ossLicenseStub },
      { provide: ThemeService, useValue: { snapshot: { branding: { name: 'DOME' } } } },
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
    legalResult = READY_DOCUMENT;
    legalContentStub = { load: jest.fn(() => of(legalResult)) };
    ossLicenseStub = {
      load: jest.fn(() => of([{ name: 'rxjs', version: '7.8.2', license: 'Apache-2.0', repository: 'https://github.com/ReactiveX/rxjs' }])),
    };
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

  it('renders the three legal documents plus the licenses row, all collapsed (AC-03)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    // 3 legal docs + licenses + contact support = 5 collapsible rows.
    const headers = panelHeaders(fixture);
    expect(headers.map((h) => h.textContent!.trim())).toEqual([
      'about.legal.terms-of-service',
      'about.legal.privacy-policy',
      'about.legal.legal-notice',
      'about.legal.licenses',
      'about.support.email',
    ]);
    expect(headers.every((h) => h.getAttribute('aria-expanded') === 'false')).toBe(true);
    expect(fixture.nativeElement.querySelector('.about-row__panel')).toBeFalsy();
  });

  it('AC-03/AC-04: expanding a legal row loads and renders its document in place', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expandPanel(fixture, 0);

    expect(legalContentStub.load).toHaveBeenCalledWith('terms-of-service');
    expect(panelHeaders(fixture)[0].getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.about-legal-content').innerHTML)
      .toContain('Contenido legal');
  });

  it('only one row stays open at a time', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expandPanel(fixture, 0);
    expandPanel(fixture, 1);

    const headers = panelHeaders(fixture);
    expect(headers[0].getAttribute('aria-expanded')).toBe('false');
    expect(headers[1].getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelectorAll('.about-row__panel').length).toBe(1);
  });

  it('clicking the open row closes it again', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expandPanel(fixture, 0);
    expandPanel(fixture, 0);

    expect(panelHeaders(fixture)[0].getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.about-row__panel')).toBeFalsy();
  });

  it('ES-01: a failing legal document shows the error state with a retry action', async () => {
    legalResult = { status: 'error', reason: 'not-found' };
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expandPanel(fixture, 0);

    expect(fixture.nativeElement.querySelector('.about-panel-status--error')).toBeTruthy();
    fixture.nativeElement.querySelector('.about-panel-retry').dispatchEvent(new MouseEvent('click'));
    expect(legalContentStub.load).toHaveBeenCalledTimes(2);
  });

  it('AC-05: expanding the licenses row lists the packaged dependencies', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expandPanel(fixture, 3);

    expect(ossLicenseStub.load).toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('.about-license').length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('rxjs');
  });

  it('renders the help center as a one-click external action (AC-06)', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);
    const helpCenter: HTMLAnchorElement = fixture.nativeElement.querySelector('a.about-row--action');

    expect(helpCenter.href).toBe('https://docs.eudistack.net/');
    expect(helpCenter.getAttribute('target')).toBe('_blank');
    expect(helpCenter.getAttribute('rel')).toBe('noopener noreferrer');
    // It acts on click — it is not one of the collapsible rows.
    expect(helpCenter.querySelector('.about-row__toggle')).toBeFalsy();
  });

  it('does not render the help center item when helpCenterUrl is null (EC-02)', async () => {
    supportStub = makeSupportChannelStub({ helpCenterUrl: null });
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expect(fixture.nativeElement.querySelector('a.about-row--action')).toBeFalsy();
    // The rest of the legal + support rows remain present.
    expect(panelHeaders(fixture).length).toBe(5);
  });

  it('AC-07: the support address and its mailto live inside the contact panel, no PII', async () => {
    const fixture = await createFixture(supportStub, modalCtrlMock);

    expect(fixture.nativeElement.querySelector('a.about-email-link')).toBeFalsy();

    expandPanel(fixture, 4);

    const emailAnchor: HTMLAnchorElement = fixture.nativeElement.querySelector('a.about-email-link');
    expect(emailAnchor.getAttribute('href')).toBe('mailto:support@eudistack.com?subject=x&body=y');
    expect(emailAnchor.textContent!.trim()).toBe('support@eudistack.com');
    expect(fixture.nativeElement.querySelector('.about-copy-btn')).toBeTruthy();
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
      const browserRows = panelHeaders(browserFixture).map((h) => h.textContent!.trim());
      const browserActions = browserFixture.nativeElement.querySelectorAll('.about-row--action').length;

      TestBed.resetTestingModule();
      supportStub = makeSupportChannelStub();
      const serverFixture = await createFixture(supportStub, modalCtrlMock, 'server');
      const serverRows = panelHeaders(serverFixture).map((h) => h.textContent!.trim());
      const serverActions = serverFixture.nativeElement.querySelectorAll('.about-row--action').length;

      expect(serverRows).toEqual(browserRows);
      expect(serverActions).toBe(browserActions);
    });
  });
});
