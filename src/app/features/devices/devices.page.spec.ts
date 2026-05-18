import { TestBed, ComponentFixture } from '@angular/core/testing';
import { DevicesPage } from './devices.page';
import { IonicModule, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from 'src/app/core/gateways/wallet-discovery.gateway';
import { PasskeyApiService } from 'src/app/core/services/passkey-api.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';

/** Minimal fake gateway — never hits the network. */
const fakeGateway = { fetch: () => of() };

/** Creates a WalletDiscoveryService stub that returns the given mode synchronously. */
function makeDiscoveryStub(resolvedMode: 'browser' | 'server'): Partial<WalletDiscoveryService> {
  return { mode: () => resolvedMode };
}

const translateServiceMock = {
  currentLang: 'en',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string) => key,
  get: (key: string) => of(key),
  getBrowserLang: jest.fn().mockReturnValue('en'),
};

const mockPasskeyApi = {
  listPasskeys: jest.fn().mockReturnValue(of([])),
  renamePasskey: jest.fn().mockReturnValue(of({})),
  deletePasskey: jest.fn().mockReturnValue(of({})),
  revokeSessions: jest.fn().mockReturnValue(of({})),
};

const mockPasskeyStore = {
  getCredentialId: jest.fn().mockReturnValue('current-cred-id'),
};

async function createModule(walletMode: 'browser' | 'server' = 'server'): Promise<ComponentFixture<DevicesPage>> {
  const routerSpy = { navigate: jest.fn() };
  const navCtrlMock = { navigateForward: jest.fn(), navigateBack: jest.fn(), navigateRoot: jest.fn() };

  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [
      DevicesPage,
      IonicModule.forRoot(),
      RouterTestingModule,
      CommonModule,
      FormsModule,
      TranslateModule.forRoot(),
    ],
    providers: [
      { provide: WalletDiscoveryService, useValue: makeDiscoveryStub(walletMode) },
      { provide: WALLET_DISCOVERY_GATEWAY, useValue: fakeGateway },
      { provide: PasskeyApiService, useValue: mockPasskeyApi },
      { provide: PasskeyStoreService, useValue: mockPasskeyStore },
      { provide: Router, useValue: routerSpy },
      { provide: NavController, useValue: navCtrlMock },
      { provide: TranslateService, useValue: translateServiceMock },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DevicesPage);
  fixture.detectChanges();
  return fixture;
}

// ---------------------------------------------------------------------------
// T-17: DevicesPage > isServerMode > reads from WalletDiscoveryService
// ---------------------------------------------------------------------------

describe('T-17: DevicesPage > isServerMode > reads from WalletDiscoveryService (AC-009.2c, AC-009.3c)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should expose isServerMode = true when discovery returns server mode', async () => {
    const fixture = await createModule('server');
    const component = fixture.componentInstance;

    expect(component.isServerMode).toBe(true);
  });

  it('should expose isServerMode = false when discovery returns browser mode', async () => {
    const fixture = await createModule('browser');
    const component = fixture.componentInstance;

    expect(component.isServerMode).toBe(false);
  });

  it('should redirect to /tabs/settings when isServerMode is false (browser mode)', async () => {
    await createModule('browser');
    const router = TestBed.inject(Router);

    expect(router.navigate).toHaveBeenCalledWith(['/tabs/settings']);
  });

  it('should load passkeys when isServerMode is true (server mode)', async () => {
    await createModule('server');

    expect(mockPasskeyApi.listPasskeys).toHaveBeenCalled();
  });

  it('should not call listPasskeys when isServerMode is false (browser mode)', async () => {
    mockPasskeyApi.listPasskeys.mockClear();
    await createModule('browser');

    expect(mockPasskeyApi.listPasskeys).not.toHaveBeenCalled();
  });
});
