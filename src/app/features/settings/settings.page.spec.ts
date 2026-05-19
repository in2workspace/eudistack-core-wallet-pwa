import { TestBed, ComponentFixture } from '@angular/core/testing';
import { SettingsPage } from './settings.page';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { CameraLogsService } from 'src/app/shared/services/camera-logs.service';
import { Observable, of } from 'rxjs';
import { IonicModule, NavController } from '@ionic/angular';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ThemeService } from 'src/app/core/services/theme.service';
import { EventEmitter, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from 'src/app/core/gateways/wallet-discovery.gateway';


const translateServiceMock = {
  currentLang: 'de',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  use: jest.fn(),
  get: jest.fn().mockImplementation((key: string): Observable<string> => {
    return of(key);
  }),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter()
};

/** Creates a WalletDiscoveryService stub that returns the given mode synchronously. */
function makeDiscoveryStub(resolvedMode: 'browser' | 'server'): Partial<WalletDiscoveryService> {
  return { mode: () => resolvedMode };
}

/** Minimal fake gateway — never hits the network. */
const fakeGateway = { fetch: () => of() };

async function createModule(walletMode: 'browser' | 'server' = 'browser'): Promise<ComponentFixture<SettingsPage>> {
  const routerMock = {
    navigate: jest.fn(),
    events: of('/'),
    createUrlTree: (commands: any, navExtras = {}) => {}
  };
  const cameraLogsServiceMock = {
    fetchCameraLogs: jest.fn().mockResolvedValue(true),
    sendCameraLogs: jest.fn(),
    buildMailtoLink: jest.fn().mockReturnValue(null),
  };
  const navCtrlMock = { navigateForward: jest.fn() };

  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [
      SettingsPage,
      IonicModule.forRoot(),
      RouterModule.forRoot([]),
      TranslateModule.forRoot(),
    ],
    providers: [
      { provide: ThemeService, useValue: { snapshot: null } },
      { provide: Router, useValue: routerMock },
      { provide: CameraLogsService, useValue: cameraLogsServiceMock },
      { provide: TranslateService, useValue: translateServiceMock },
      { provide: NavController, useValue: navCtrlMock },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { data: '' } } } },
      { provide: PwaInstallService, useValue: { installable$: of(false), promptInstall: jest.fn() } },
      { provide: UserPreferencesService, useValue: {
        privacyBlur: signal(false),
        darkMode: signal(false),
        togglePrivacyBlur: jest.fn(),
        toggleDarkMode: jest.fn(),
      } },
      { provide: WalletDiscoveryService, useValue: makeDiscoveryStub(walletMode) },
      { provide: WALLET_DISCOVERY_GATEWAY, useValue: fakeGateway },
    ]
  }).compileComponents();

  const fixture = TestBed.createComponent(SettingsPage);
  fixture.detectChanges();
  return fixture;
}


describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;
  let translateService: TranslateService;
  let cameraLogsService: CameraLogsService;

  beforeEach(async () => {
    fixture = await createModule('browser');
    component = fixture.componentInstance;
    translateService = TestBed.inject(TranslateService);
    cameraLogsService = TestBed.inject(CameraLogsService);

    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should configure TranslateService correctly', () => {
    expect(translateService.get).toBeDefined();
    expect(translateService.onLangChange).toBeDefined();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should fetch and send camera logs on sendCameraLogs', (done) => {
    const translateSpy = jest.spyOn(translateService, 'get').mockReturnValue(of('translated_message'));
    const fetchLogsSpy = jest.spyOn(cameraLogsService, 'fetchCameraLogs').mockResolvedValue();
    const buildMailtoLinkSpy = jest.spyOn(cameraLogsService, 'buildMailtoLink').mockReturnValue('mailto:test@example.com?subject=Camera%20Logs&body=test');

    component.sendCameraLogs();


    setTimeout(() => {
      expect(translateSpy).toHaveBeenCalledWith('mailto_permission_alert');
      expect(fetchLogsSpy).toHaveBeenCalled();
      expect(buildMailtoLinkSpy).toHaveBeenCalled();
      done();
    }, 0);
  });

  it('should log error when sendCameraLogs fails', (done) => {
    const translateSpy = jest.spyOn(translateService, 'get').mockReturnValue(of('translated_message'));
    const fetchLogsSpy = jest.spyOn(cameraLogsService, 'fetchCameraLogs').mockRejectedValue(new Error('Fetch error'));
    const sendLogsSpy = jest.spyOn(cameraLogsService, 'sendCameraLogs');
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    component.sendCameraLogs();

    setTimeout(() => {
      expect(translateSpy).toHaveBeenCalledWith('mailto_permission_alert');
      expect(fetchLogsSpy).toHaveBeenCalled();
      expect(sendLogsSpy).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error sending camera logs:', new Error('Fetch error'));
      done();
    }, 0);
  });

  // ---------------------------------------------------------------------------
  // T-16: SettingsPage > isServerMode > reads from WalletDiscoveryService
  // ---------------------------------------------------------------------------

  describe('T-16: isServerMode reads from WalletDiscoveryService (AC-009.2c, AC-009.3c)', () => {
    it('should expose isServerMode = false when discovery returns browser mode', async () => {
      expect(component.isServerMode).toBe(false);
    });

    it('should expose isServerMode = true when discovery returns server mode', async () => {
      TestBed.resetTestingModule();
      const serverFixture = await createModule('server');
      const serverComponent = serverFixture.componentInstance;

      expect(serverComponent.isServerMode).toBe(true);
    });

    it('should return wallet-mode-eudiw key when in browser mode', () => {
      expect(component.walletModeKey).toBe('settings.wallet-mode-eudiw');
    });

    it('should return wallet-mode-business key when in server mode', async () => {
      TestBed.resetTestingModule();
      const serverFixture = await createModule('server');
      const serverComponent = serverFixture.componentInstance;

      expect(serverComponent.walletModeKey).toBe('settings.wallet-mode-business');
    });
  });
});
