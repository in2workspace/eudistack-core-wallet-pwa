import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { ActionSheetController, AlertController } from '@ionic/angular';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { NEVER, of, throwError } from 'rxjs';
import { DEVICE_LIST_TIMEOUT_MS, DevicesPage } from './devices.page';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletInstance, WalletInstanceService } from 'src/app/core/services/wallet-instance.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';

const translate = {
  currentLang: 'es',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
  get: (key: string) => of(key),
  stream: (key: string) => of(key),
  getBrowserLang: () => 'es',
};

function device(overrides: Partial<WalletInstance>): WalletInstance {
  return {
    id: 'wi', displayName: 'Device', deviceType: 'desktop', createdAt: '2026-07-01T10:00:00Z',
    lastUsedAt: null, current: false, ...overrides,
  };
}

const CURRENT = device({ id: 'wi-1', displayName: 'iPhone · App instalada', deviceType: 'mobile', current: true,
  createdAt: '2026-10-12T10:00:00Z', lastUsedAt: '2026-10-30T10:00:00Z' });
const MAC = device({ id: 'wi-2', displayName: 'Mac · Chrome', createdAt: '2026-09-03T10:00:00Z',
  lastUsedAt: '2026-10-27T10:00:00Z' });
const WINDOWS = device({ id: 'wi-3', displayName: 'Windows · Edge', createdAt: '2026-07-01T10:00:00Z',
  lastUsedAt: '2026-07-02T10:00:00Z' });

describe('DevicesPage (EUD-15 "Dispositivos")', () => {
  let fixture: ComponentFixture<DevicesPage>;
  let page: DevicesPage;
  let instances: { list: jest.Mock; rename: jest.Mock; revoke: jest.Mock; forget: jest.Mock };
  let auth: { accountId: jest.Mock; forceLogout: jest.Mock };
  let alerts: { create: jest.Mock };
  let sheets: { create: jest.Mock };
  let lastAlert: { present: jest.Mock; message?: string; buttons: { text: string; handler?: (data?: unknown) => unknown }[] };

  async function create(mode: 'server' | 'browser' = 'server'): Promise<void> {
    await TestBed.configureTestingModule({
      schemas: [NO_ERRORS_SCHEMA],
      imports: [DevicesPage, TranslateModule.forRoot()],
      providers: [
        { provide: TranslateService, useValue: translate },
        { provide: WalletInstanceService, useValue: instances },
        { provide: RemoteAuthService, useValue: auth },
        { provide: AlertController, useValue: alerts },
        { provide: ActionSheetController, useValue: sheets },
        { provide: Router, useValue: { navigate: jest.fn() } },
        { provide: WalletDiscoveryService, useValue: { mode: () => mode } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(DevicesPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  }

  function text(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  /** The handler of the alert button with that text. */
  function button(label: string): (data?: unknown) => unknown {
    const found = lastAlert.buttons.find(b => b.text === label);
    if (!found?.handler) throw new Error(`No handler for ${label}`);
    return found.handler;
  }

  beforeEach(() => {
    instances = {
      list: jest.fn().mockReturnValue(of([WINDOWS, MAC, CURRENT])),
      rename: jest.fn(),
      revoke: jest.fn().mockReturnValue(of(undefined)),
      forget: jest.fn().mockResolvedValue(undefined),
    };
    auth = { accountId: jest.fn().mockReturnValue('sub-1'), forceLogout: jest.fn() };
    alerts = {
      create: jest.fn().mockImplementation(async options => {
        lastAlert = { present: jest.fn(), ...options };
        return lastAlert;
      }),
    };
    sheets = { create: jest.fn().mockResolvedValue({ present: jest.fn() }) };
  });

  afterEach(() => TestBed.resetTestingModule());

  it('lists the devices with the current one first and marked with text, then by last use (AC-11)', async () => {
    await create();

    expect(page.sortedDevices().map(d => d.id)).toEqual(['wi-1', 'wi-2', 'wi-3']);
    const content = text();
    expect(content).toContain('iPhone · App instalada');
    expect(content).toContain('devices.this-device');
    expect(content).toContain('devices.now');
    expect(content).toContain('03/09/2026');
    expect(content).toContain('27/10/2026');
  });

  it('shows the load error with Retry, and retries', async () => {
    instances.list.mockReturnValueOnce(throwError(() => new Error('down')));
    await create();

    expect(page.error()).toBe(true);
    expect(text()).toContain('devices.load-error');

    page.load();

    expect(page.error()).toBe(false);
    expect(page.devices().length).toBe(3);
  });

  it('gives up loading after the timeout', async () => {
    jest.useFakeTimers();
    instances.list.mockReturnValue(NEVER);
    await create();

    jest.advanceTimersByTime(DEVICE_LIST_TIMEOUT_MS + 1);

    expect(page.error()).toBe(true);
    jest.useRealTimers();
  });

  it('is not available in browser mode', async () => {
    await create('browser');

    expect(page.unavailable()).toBe(true);
    expect(instances.list).not.toHaveBeenCalled();
  });

  it('offers Rename and Revoke in the menu of a device', async () => {
    await create();

    await page.openMenu(MAC);

    const options = sheets.create.mock.calls[0][0].buttons.map((b: { text: string }) => b.text);
    expect(options).toEqual(['devices.rename', 'devices.revoke', 'devices.cancel']);
  });

  describe('rename (FR-12, AC-13)', () => {
    it('keeps the dialog open with a message for an empty or too long name', async () => {
      await create();
      await page.rename(MAC);

      expect(await button('devices.save')({ displayName: '  ' })).toBe(false);
      expect(await button('devices.save')({ displayName: 'x'.repeat(51) })).toBe(false);
      expect(lastAlert.message).toContain('devices.rename-invalid');
      expect(instances.rename).not.toHaveBeenCalled();
    });

    it('saves a valid name and shows it in the list', async () => {
      instances.rename.mockReturnValue(of({ ...MAC, displayName: 'Portátil' }));
      await create();
      await page.rename(MAC);

      expect(await button('devices.save')({ displayName: 'Portátil' })).toBe(true);
      expect(instances.rename).toHaveBeenCalledWith('wi-2', 'Portátil');
      expect(text()).toContain('Portátil');
    });

    it('keeps the dialog open when the name cannot be saved', async () => {
      instances.rename.mockReturnValue(throwError(() => new Error('down')));
      await create();
      await page.rename(MAC);

      expect(await button('devices.save')({ displayName: 'Portátil' })).toBe(false);
      expect(lastAlert.message).toBe('devices.rename-failed');
    });
  });

  describe('revoke (FR-13 to FR-17, AC-14, AC-15)', () => {
    it('confirms another device and removes it from the list', async () => {
      await create();
      await page.revoke(MAC);

      expect(alerts.create.mock.calls[0][0].header).toContain('devices.revoke-header');
      expect(alerts.create.mock.calls[0][0].message).toBe('devices.revoke-message');
      expect(await button('devices.revoke-confirm')()).toBe(true);
      expect(instances.revoke).toHaveBeenCalledWith('wi-2');
      expect(page.devices().map(d => d.id)).not.toContain('wi-2');
      expect(auth.forceLogout).not.toHaveBeenCalled();
    });

    it('warns that the current device ends the session, then forgets it and goes to the access screen', async () => {
      await create();
      await page.revoke(CURRENT);

      expect(alerts.create.mock.calls[0][0].header).toBe('devices.revoke-current-header');
      expect(alerts.create.mock.calls[0][0].message).toBe('devices.revoke-current-message');
      expect(await button('devices.revoke-current-confirm')()).toBe(true);
      expect(instances.forget).toHaveBeenCalledWith('sub-1');
      expect(auth.forceLogout).toHaveBeenCalled();
    });

    it('keeps the dialog open when the revocation fails and never logs out', async () => {
      instances.revoke.mockReturnValue(throwError(() => new Error('down')));
      await create();
      await page.revoke(CURRENT);

      expect(await button('devices.revoke-current-confirm')()).toBe(false);
      expect(lastAlert.message).toBe('devices.revoke-failed');
      expect(auth.forceLogout).not.toHaveBeenCalled();
      expect(instances.forget).not.toHaveBeenCalled();
    });
  });
});
