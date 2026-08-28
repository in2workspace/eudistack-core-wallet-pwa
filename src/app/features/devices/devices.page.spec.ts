import { TestBed, ComponentFixture } from '@angular/core/testing';
import { DevicesPage } from './devices.page';
import { AlertController, IonicModule, NavController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { Router } from '@angular/router';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { of, throwError } from 'rxjs';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { WALLET_DISCOVERY_GATEWAY } from 'src/app/core/gateways/wallet-discovery.gateway';
import { AuthService } from 'src/app/core/services/auth.service';
import { PasskeyApiService, PasskeyInfo } from 'src/app/core/services/passkey-api.service';
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
  clearCredentialId: jest.fn().mockResolvedValue(undefined),
};

const mockAuthService = {
  forceLogout: jest.fn(),
};

/** Default: resolves the alert without invoking any button handler (acts as a no-op cancel). */
const mockAlertController = {
  create: jest.fn().mockResolvedValue({ present: jest.fn() }),
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
      { provide: AuthService, useValue: mockAuthService },
      { provide: AlertController, useValue: mockAlertController },
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

// ---------------------------------------------------------------------------
// Shared fixture data
// ---------------------------------------------------------------------------

const BASE_PASSKEY: PasskeyInfo = {
  id: '1',
  credentialId: 'cred-1',
  displayName: 'My Laptop',
  createdAt: '2024-01-15T10:00:00Z',
  lastUsedAt: '2024-06-01T08:30:00Z',
  activeSessions: 0,
};

// ---------------------------------------------------------------------------
// T7: DevicesPage > device list rendering
//     Covers AC-02, AC-03, AC-05, EC-01, EC-02, EC-03, EC-04
// ---------------------------------------------------------------------------

describe('T7: DevicesPage > device list rendering (EUD-143)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset to safe defaults before each test
    mockPasskeyApi.listPasskeys.mockReturnValue(of([]));
    mockPasskeyStore.getCredentialId.mockReturnValue('current-cred-id');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-05 -----------------------------------------------------------

  it('AC-05: should show empty-state without error when account has no devices', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([]));
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.empty-state')).toBeTruthy();
    expect(el.querySelector('.error-state')).toBeFalsy();
    expect(el.querySelector('.passkey-list')).toBeFalsy();
  });

  // --- AC-02 -----------------------------------------------------------

  it('AC-02: should display displayName, createdAt and lastUsedAt for each device', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY]));
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    // displayName
    expect(el.textContent).toContain('My Laptop');
    // createdAt rendered via .passkey-date
    expect(el.querySelector('.passkey-date')).toBeTruthy();
    // lastUsedAt rendered via .passkey-last-used
    const lastUsedEl = el.querySelector('.passkey-last-used');
    expect(lastUsedEl).toBeTruthy();
    // Should NOT show the never-used key when lastUsedAt has a value
    expect(lastUsedEl!.textContent).not.toContain('devices.last-used-never');
  });

  // --- AC-03 -----------------------------------------------------------

  it('AC-03: should show this-device badge on the entry matching currentCredentialId', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue('cred-1');
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY]));
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    const badge = el.querySelector('.this-device-badge');
    expect(badge).toBeTruthy();
    // Must have text content (non-colour-only mark, WCAG 2.1 AA)
    expect(badge!.textContent!.trim().length).toBeGreaterThan(0);
  });

  it('AC-03: should mark exactly one device when multiple devices exist and one matches', async () => {
    const passkeys: PasskeyInfo[] = [
      { ...BASE_PASSKEY, id: '1', credentialId: 'cred-1', displayName: 'Device A' },
      { ...BASE_PASSKEY, id: '2', credentialId: 'cred-2', displayName: 'Device B' },
    ];
    mockPasskeyStore.getCredentialId.mockReturnValue('cred-1');
    mockPasskeyApi.listPasskeys.mockReturnValue(of(passkeys));
    const fixture = await createModule('server');
    const badges = fixture.nativeElement.querySelectorAll('.this-device-badge');

    expect(badges.length).toBe(1);
  });

  // --- EC-01 -----------------------------------------------------------

  it('EC-01: should show list with one device and mark it as the current device', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue('cred-1');
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY]));
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    const badges = el.querySelectorAll('.this-device-badge');
    expect(badges.length).toBe(1);
    expect(el.textContent).toContain('My Laptop');
  });

  // --- EC-02 -----------------------------------------------------------

  it('EC-02: should show last-used-never i18n key when lastUsedAt is null', async () => {
    const passkeyNoLastUsed: PasskeyInfo = { ...BASE_PASSKEY, lastUsedAt: null };
    mockPasskeyApi.listPasskeys.mockReturnValue(of([passkeyNoLastUsed]));
    const fixture = await createModule('server');
    const lastUsedEl = fixture.nativeElement.querySelector('.passkey-last-used');

    expect(lastUsedEl).toBeTruthy();
    // TranslateService mock returns the key itself
    expect(lastUsedEl.textContent.trim()).toContain('devices.last-used-never');
  });

  it('EC-02: should not show an empty date or throw when lastUsedAt is null', async () => {
    const passkeyNoLastUsed: PasskeyInfo = { ...BASE_PASSKEY, lastUsedAt: null };
    mockPasskeyApi.listPasskeys.mockReturnValue(of([passkeyNoLastUsed]));
    const fixture = await createModule('server');
    const lastUsedEl = fixture.nativeElement.querySelector('.passkey-last-used');

    expect(lastUsedEl.textContent).not.toMatch(/Invalid Date/);
    expect(lastUsedEl.textContent.trim()).not.toBe('');
  });

  // --- EC-03 -----------------------------------------------------------

  it('EC-03: should not mark any device when currentCredentialId does not match any entry', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue('non-existent-cred');
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY]));
    const fixture = await createModule('server');
    const badges = fixture.nativeElement.querySelectorAll('.this-device-badge');

    expect(badges.length).toBe(0);
  });

  it('EC-03: should not mark any device when currentCredentialId is null (fail-safe AD-2)', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue(null);
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY]));
    const fixture = await createModule('server');
    const badges = fixture.nativeElement.querySelectorAll('.this-device-badge');

    expect(badges.length).toBe(0);
  });

  // --- EC-04 -----------------------------------------------------------

  it('EC-04: should render all N devices in the order returned by the API', async () => {
    const passkeys: PasskeyInfo[] = [
      { ...BASE_PASSKEY, id: '1', credentialId: 'cred-1', displayName: 'Device A' },
      { ...BASE_PASSKEY, id: '2', credentialId: 'cred-2', displayName: 'Device B' },
      { ...BASE_PASSKEY, id: '3', credentialId: 'cred-3', displayName: 'Device C' },
    ];
    mockPasskeyApi.listPasskeys.mockReturnValue(of(passkeys));
    const fixture = await createModule('server');
    const headings: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.passkey-header h2');
    const names = Array.from(headings).map(h => h.textContent!.trim());

    expect(names).toEqual(['Device A', 'Device B', 'Device C']);
  });

  it('EC-04: should render all 3 devices without duplicates or omissions', async () => {
    const passkeys: PasskeyInfo[] = [
      { ...BASE_PASSKEY, id: '1', credentialId: 'cred-1', displayName: 'Device A' },
      { ...BASE_PASSKEY, id: '2', credentialId: 'cred-2', displayName: 'Device B' },
      { ...BASE_PASSKEY, id: '3', credentialId: 'cred-3', displayName: 'Device C' },
    ];
    mockPasskeyApi.listPasskeys.mockReturnValue(of(passkeys));
    const fixture = await createModule('server');
    const headings = fixture.nativeElement.querySelectorAll('.passkey-header h2');

    expect(headings.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// T8: DevicesPage > error scenarios (ES-02, ES-03, ES-04)
// ---------------------------------------------------------------------------

describe('T8: DevicesPage > error scenarios (EUD-143)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPasskeyApi.listPasskeys.mockReturnValue(of([]));
    mockPasskeyStore.getCredentialId.mockReturnValue('current-cred-id');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- ES-02 -----------------------------------------------------------
  // Already covered by T-17 ("should redirect to /tabs/settings when isServerMode is false").
  // Reproduced here for explicit AC traceability.

  it('ES-02: should redirect to /tabs/settings and not load passkeys in browser mode', async () => {
    await createModule('browser');
    const router = TestBed.inject(Router);

    expect(router.navigate).toHaveBeenCalledWith(['/tabs/settings']);
    expect(mockPasskeyApi.listPasskeys).not.toHaveBeenCalled();
  });

  // --- ES-03 -----------------------------------------------------------

  it('ES-03: should show error state with retry action when backend responds 5xx', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(
      throwError(() => ({ status: 500, message: 'Internal Server Error' }))
    );
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.error-state')).toBeTruthy();
    expect(el.querySelector('.loading-state')).toBeFalsy();
    // Retry button must be present (ES-03: action de reintento visible)
    const retryButton = el.querySelector('ion-button[ng-reflect-fill="outline"]') ??
                        el.querySelector('.error-state ion-button');
    expect(retryButton).toBeTruthy();
  });

  it('ES-03: should not render partial data or passkey list when backend fails', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(
      throwError(() => ({ status: 503, message: 'Service Unavailable' }))
    );
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.passkey-list')).toBeFalsy();
    expect(el.querySelector('.error-state')).toBeTruthy();
  });

  it('ES-03: should clear error and reload passkeys when retry is triggered', async () => {
    // First call fails, second succeeds
    mockPasskeyApi.listPasskeys
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValueOnce(of([BASE_PASSKEY]));
    const fixture = await createModule('server');

    // Trigger retry
    fixture.componentInstance.loadPasskeys();
    fixture.detectChanges();

    expect(fixture.componentInstance.error()).toBe(false);
    expect(fixture.componentInstance.passkeys().length).toBe(1);
  });

  // --- ES-04 -----------------------------------------------------------

  it('ES-04: should show error state (not infinite loading) when request times out', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError', message: 'Timeout' }))
    );
    const fixture = await createModule('server');
    const el: HTMLElement = fixture.nativeElement;

    // Must not be stuck in loading
    expect(el.querySelector('.loading-state')).toBeFalsy();
    // Must show recoverable error state
    expect(el.querySelector('.error-state')).toBeTruthy();
  });

  it('ES-04: should not block navigation when request times out', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError', message: 'Timeout' }))
    );
    const fixture = await createModule('server');

    // Component should be in error state, not loading — navigation is unblocked
    expect(fixture.componentInstance.loading()).toBe(false);
    expect(fixture.componentInstance.error()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// EUD-144 T8: DevicesPage > revoke device — happy path
//     Covers AC-01, AC-02, AC-03, EC-04
// ---------------------------------------------------------------------------

/** Finds the given role's button in the captured alert options and invokes its handler. */
function pressAlertButton(opts: { buttons: Array<{ role?: string; handler?: () => void }> }, role: string): void {
  const button = opts.buttons.find(b => b.role === role);
  button?.handler?.();
}

const OTHER_PASSKEY: PasskeyInfo = {
  id: '2',
  credentialId: 'cred-other',
  displayName: 'Work Phone',
  createdAt: '2024-02-10T10:00:00Z',
  lastUsedAt: '2024-06-02T08:30:00Z',
  activeSessions: 0,
};

describe('EUD-144 T8: DevicesPage > revoke device — happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPasskeyApi.listPasskeys.mockReturnValue(of([OTHER_PASSKEY]));
    mockPasskeyApi.deletePasskey.mockReturnValue(of(undefined));
    mockPasskeyStore.getCredentialId.mockReturnValue('current-cred-id');
    mockPasskeyStore.clearCredentialId.mockResolvedValue(undefined);
    mockAlertController.create.mockResolvedValue({ present: jest.fn() });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-01 -------------------------------------------------------------

  it('AC-01: should call deletePasskey with the target id when revoking a device other than the current one', async () => {
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockPasskeyApi.deletePasskey).toHaveBeenCalledWith(OTHER_PASSKEY.id);
  });

  it('AC-01: should keep the session active after revoking a device other than the current one', async () => {
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockPasskeyStore.clearCredentialId).not.toHaveBeenCalled();
    expect(mockAuthService.forceLogout).not.toHaveBeenCalled();
  });

  // --- AC-02 ---------------------------------------------------------------

  it('AC-02: should show a confirmation dialog with the standard message before revoking a device other than the current one', async () => {
    mockAlertController.create.mockResolvedValue({ present: jest.fn() });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockAlertController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'devices.delete-header',
        message: 'devices.delete-message',
      })
    );
  });

  it('AC-02: should not call the API when the confirmation dialog is dismissed without confirming', async () => {
    // Default mock resolves the alert without invoking any button handler.
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockPasskeyApi.deletePasskey).not.toHaveBeenCalled();
  });

  // --- AC-03 ---------------------------------------------------------------

  it('AC-03: should remove the revoked device from the list after a successful revoke', async () => {
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(fixture.componentInstance.passkeys().some(p => p.id === OTHER_PASSKEY.id)).toBe(false);
  });

  // --- EC-04 ---------------------------------------------------------------

  it('EC-04: should not force logout when revoking another device while the current device is also listed', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY, OTHER_PASSKEY]));
    mockPasskeyStore.getCredentialId.mockReturnValue(BASE_PASSKEY.credentialId);
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockPasskeyStore.clearCredentialId).not.toHaveBeenCalled();
    expect(mockAuthService.forceLogout).not.toHaveBeenCalled();
    expect(fixture.componentInstance.passkeys().some(p => p.id === BASE_PASSKEY.id)).toBe(true);
  });

  it('EC-04: should use the standard (non-reinforced) message when revoking another device while the current device is also listed', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([BASE_PASSKEY, OTHER_PASSKEY]));
    mockPasskeyStore.getCredentialId.mockReturnValue(BASE_PASSKEY.credentialId);
    mockAlertController.create.mockResolvedValue({ present: jest.fn() });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockAlertController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'devices.delete-message' })
    );
  });
});

// ---------------------------------------------------------------------------
// EUD-144 T9: DevicesPage > self-revoke
//     Covers AC-06, EC-03
// ---------------------------------------------------------------------------

const CURRENT_PASSKEY: PasskeyInfo = {
  id: '1',
  credentialId: 'current-cred-id',
  displayName: 'My Laptop',
  createdAt: '2024-01-15T10:00:00Z',
  lastUsedAt: '2024-06-01T08:30:00Z',
  activeSessions: 0,
};

describe('EUD-144 T9: DevicesPage > self-revoke', () => {
  let callOrder: string[];

  beforeEach(() => {
    jest.clearAllMocks();
    callOrder = [];
    mockPasskeyApi.listPasskeys.mockReturnValue(of([CURRENT_PASSKEY]));
    mockPasskeyApi.deletePasskey.mockReturnValue(of(undefined));
    mockPasskeyStore.getCredentialId.mockReturnValue(CURRENT_PASSKEY.credentialId);
    mockPasskeyStore.clearCredentialId.mockImplementation(async () => {
      callOrder.push('clearCredentialId');
    });
    mockAuthService.forceLogout.mockImplementation(() => {
      callOrder.push('forceLogout');
    });
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-06 ---------------------------------------------------------------

  it('AC-06: should show the reinforced confirmation message when revoking the current device', async () => {
    mockAlertController.create.mockResolvedValue({ present: jest.fn() });
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);

    expect(mockAlertController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'devices.delete-self-message' })
    );
  });

  it('AC-06: should clear the local credential id and force logout after revoking the current device', async () => {
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);

    expect(mockPasskeyStore.clearCredentialId).toHaveBeenCalled();
    expect(mockAuthService.forceLogout).toHaveBeenCalled();
  });

  it('AC-06 (R-2): should clear the local credential id before forcing logout', async () => {
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);

    expect(callOrder).toEqual(['clearCredentialId', 'forceLogout']);
  });

  // --- EC-03 ---------------------------------------------------------------

  it('EC-03: should not clear the credential id or force logout when the local credential id cannot be resolved (null)', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue(null);
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);

    expect(mockPasskeyStore.clearCredentialId).not.toHaveBeenCalled();
    expect(mockAuthService.forceLogout).not.toHaveBeenCalled();
  });

  it('EC-03: should use the standard (non-reinforced) message when the local credential id cannot be resolved (null)', async () => {
    mockPasskeyStore.getCredentialId.mockReturnValue(null);
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);

    expect(mockAlertController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'devices.delete-message' })
    );
  });
});

// ---------------------------------------------------------------------------
// EUD-144 T10: DevicesPage > revoke device — error/edge scenarios
//     Covers EC-01/ES-03 (409 last-passkey), EC-02 (cancel), ES-04 (5xx), ES-05 (timeout)
// ---------------------------------------------------------------------------

describe('EUD-144 T10: DevicesPage > revoke device — error/edge scenarios', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPasskeyApi.listPasskeys.mockReturnValue(of([OTHER_PASSKEY]));
    mockPasskeyStore.getCredentialId.mockReturnValue('current-cred-id');
    mockPasskeyStore.clearCredentialId.mockResolvedValue(undefined);
    mockAlertController.create.mockImplementation((opts) => {
      pressAlertButton(opts, 'destructive');
      return Promise.resolve({ present: jest.fn() });
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- EC-01 / ES-03 — 409 last passkey ------------------------------------

  it('EC-01/ES-03: should show the last-passkey error message when the backend responds 409', async () => {
    mockPasskeyApi.deletePasskey.mockReturnValue(throwError(() => ({ status: 409 })));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);
    await Promise.resolve();

    expect(mockAlertController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'devices.error-header',
        message: 'devices.last-passkey-error',
      })
    );
  });

  it('EC-01/ES-03: should not remove the device from the list when the backend responds 409', async () => {
    mockPasskeyApi.deletePasskey.mockReturnValue(throwError(() => ({ status: 409 })));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);
    await Promise.resolve();

    expect(fixture.componentInstance.passkeys().some(p => p.id === OTHER_PASSKEY.id)).toBe(true);
  });

  // --- EC-02 — cancel the confirmation dialog ------------------------------

  it('EC-02: should not call deletePasskey when the confirmation dialog is cancelled', async () => {
    // Simulates pressing the 'cancel' button: no handler is wired for it (Ionic just dismisses).
    mockAlertController.create.mockImplementation(() => Promise.resolve({ present: jest.fn() }));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(mockPasskeyApi.deletePasskey).not.toHaveBeenCalled();
  });

  it('EC-02: should leave the devices list unchanged when the confirmation dialog is cancelled', async () => {
    mockAlertController.create.mockImplementation(() => Promise.resolve({ present: jest.fn() }));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);

    expect(fixture.componentInstance.passkeys()).toEqual([OTHER_PASSKEY]);
  });

  // --- ES-04 — backend 5xx --------------------------------------------------

  it('ES-04: should not remove the device from the list when the backend responds 5xx', async () => {
    mockPasskeyApi.deletePasskey.mockReturnValue(throwError(() => ({ status: 500 })));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);
    await Promise.resolve();

    expect(fixture.componentInstance.passkeys().some(p => p.id === OTHER_PASSKEY.id)).toBe(true);
  });

  it('ES-04: should not force logout on a failed self-revoke when the backend responds 5xx', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([CURRENT_PASSKEY]));
    mockPasskeyStore.getCredentialId.mockReturnValue(CURRENT_PASSKEY.credentialId);
    mockPasskeyApi.deletePasskey.mockReturnValue(throwError(() => ({ status: 500 })));
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);
    await Promise.resolve();

    expect(mockPasskeyStore.clearCredentialId).not.toHaveBeenCalled();
    expect(mockAuthService.forceLogout).not.toHaveBeenCalled();
  });

  // --- ES-05 — timeout --------------------------------------------------

  it('ES-05: should not remove the device from the list when the request times out', async () => {
    mockPasskeyApi.deletePasskey.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError', message: 'Timeout' }))
    );
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(OTHER_PASSKEY);
    await Promise.resolve();

    expect(fixture.componentInstance.passkeys().some(p => p.id === OTHER_PASSKEY.id)).toBe(true);
  });

  it('ES-05: should not force logout on a failed self-revoke when the request times out', async () => {
    mockPasskeyApi.listPasskeys.mockReturnValue(of([CURRENT_PASSKEY]));
    mockPasskeyStore.getCredentialId.mockReturnValue(CURRENT_PASSKEY.credentialId);
    mockPasskeyApi.deletePasskey.mockReturnValue(
      throwError(() => ({ name: 'TimeoutError', message: 'Timeout' }))
    );
    const fixture = await createModule('server');

    await fixture.componentInstance.deletePasskey(CURRENT_PASSKEY);
    await Promise.resolve();

    expect(mockPasskeyStore.clearCredentialId).not.toHaveBeenCalled();
    expect(mockAuthService.forceLogout).not.toHaveBeenCalled();
  });
});
