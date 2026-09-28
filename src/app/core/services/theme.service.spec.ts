import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ThemeService } from './theme.service';
import { ColorService } from '../../shared/services/color-service.service';
import { StorageService } from '../../shared/services/storage.service';
import { Theme } from '../models/theme.model';
import { EnvironmentService } from './environment.service';

class ColorServiceMock {
  applyCustomColors = jest.fn();
}

class StorageServiceMock {
  get = jest.fn().mockResolvedValue(null);
}

const buildTheme = (overrides: Partial<Theme['branding']> = {}): Theme => ({
  tenantDomain: 'test',
  branding: {
    name: 'Test',
    primaryColor: '#001E8C',
    primaryContrastColor: '#FFFFFF',
    secondaryColor: '#003DA5',
    secondaryContrastColor: '#FFFFFF',
    logoUrl: 'assets/tenant/logo.png',
    logoDarkUrl: null,
    faviconUrl: 'assets/tenant/favicon.png',
    pwaIconUrl: 'assets/tenant/icon.png',
    ...overrides,
  },
  content: { links: [], footer: '' },
  i18n: { defaultLang: 'en', available: ['en'] },
});

describe('ThemeService', () => {
  let service: ThemeService;
  let root: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, TranslateModule.forRoot()],
      providers: [
        ThemeService,
        { provide: ColorService, useClass: ColorServiceMock },
        { provide: StorageService, useClass: StorageServiceMock },
      ],
    });

    service = TestBed.inject(ThemeService);
    root = document.documentElement;
    root.removeAttribute('style');
  });

  describe('isValidCssColor', () => {
    const validate = (v: string) => (service as any).isValidCssColor(v);

    it('should accept valid 3-digit hex', () => {
      expect(validate('#FFF')).toBe(true);
      expect(validate('#abc')).toBe(true);
    });

    it('should accept valid 6-digit hex', () => {
      expect(validate('#001E8C')).toBe(true);
      expect(validate('#ffffff')).toBe(true);
    });

    it('should accept valid 8-digit hex (with alpha)', () => {
      expect(validate('#001E8CFF')).toBe(true);
    });

    it('should reject CSS url() values', () => {
      expect(validate('url(https://evil.com)')).toBe(false);
    });

    it('should reject CSS property injection', () => {
      expect(validate('#000; --other: red')).toBe(false);
    });

    it('should reject non-hex strings', () => {
      expect(validate('red')).toBe(false);
      expect(validate('rgb(0,0,0)')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validate('')).toBe(false);
    });
  });

  describe('isSafeAssetPath', () => {
    const validate = (v: string) => (service as any).isSafeAssetPath(v);

    it('should accept paths starting with assets/', () => {
      expect(validate('assets/tenant/favicon.png')).toBe(true);
    });

    it('should accept paths starting with /assets/', () => {
      expect(validate('/assets/tenant/favicon.png')).toBe(true);
    });

    it('should reject absolute URLs', () => {
      expect(validate('https://evil.com/tracker.png')).toBe(false);
    });

    it('should reject protocol-relative URLs', () => {
      expect(validate('//evil.com/tracker.png')).toBe(false);
    });

    it('should reject data URIs', () => {
      expect(validate('data:image/png;base64,abc')).toBe(false);
    });
  });

  describe('applyContextTokens', () => {
    it('should set CSS custom properties for valid hex colors', () => {
      const theme = buildTheme({
        card: { background: '#00FF00' },
      });

      (service as any).applyContextTokens(theme, root);

      expect(root.style.getPropertyValue('--card-background')).toBe('#00FF00');
    });

    it('should NOT set CSS properties when context overrides are absent', () => {
      const theme = buildTheme();

      (service as any).applyContextTokens(theme, root);

      expect(root.style.getPropertyValue('--card-background')).toBe('');
    });
  });
});

describe('ThemeService environment label', () => {
  const readBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(blob);
    });

  const setup = (label: string | null): ThemeService => {
    const environment = {
      label,
      decorate: (name: string) => (label ? `${name} (${label})` : name),
      decorateShort: (name: string) => (label ? `${name} ${label}` : name),
    };
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule, TranslateModule.forRoot()],
      providers: [
        ThemeService,
        { provide: EnvironmentService, useValue: environment },
        { provide: ColorService, useClass: ColorServiceMock },
        { provide: StorageService, useClass: StorageServiceMock },
      ],
    });
    return TestBed.inject(ThemeService);
  };

  let createObjectURL: jest.Mock;
  let manifestBlob: Blob | undefined;

  beforeEach(() => {
    document.head.innerHTML = '<link rel="manifest" href="manifest.webmanifest"><meta name="theme-color" content="#000">';
    document.title = '';
    manifestBlob = undefined;
    createObjectURL = jest.fn((blob: Blob) => {
      manifestBlob = blob;
      return 'blob:manifest';
    });
    (URL as any).createObjectURL = createObjectURL;
  });

  afterEach(() => {
    delete (URL as any).createObjectURL;
    document.head.innerHTML = '';
  });

  it('labels the installed name and the iOS title on DEV, leaving the tab title untouched', async () => {
    const service = setup('DEV');

    (service as any).applyTheme(buildTheme({ name: 'EUDIStack' }));

    const manifest = JSON.parse(await readBlob(manifestBlob as Blob));
    expect(manifest.name).toBe('EUDIStack Wallet (DEV)');
    expect(manifest.short_name).toBe('EUDIStack DEV');
    expect(document.querySelector<HTMLMetaElement>("meta[name='apple-mobile-web-app-title']")?.content).toBe(
      'EUDIStack DEV',
    );
    expect(document.title).toBe('EUDIStack');
  });

  it('labels the installed name on STG', async () => {
    const service = setup('STG');

    (service as any).applyTheme(buildTheme({ name: 'EUDIStack' }));

    const manifest = JSON.parse(await readBlob(manifestBlob as Blob));
    expect(manifest.name).toBe('EUDIStack Wallet (STG)');
    expect(manifest.short_name).toBe('EUDIStack STG');
  });

  it('does not label the installed name when there is no environment label', async () => {
    const service = setup(null);

    (service as any).applyTheme(buildTheme({ name: 'EUDIStack' }));

    const manifest = JSON.parse(await readBlob(manifestBlob as Blob));
    expect(manifest.name).toBe('EUDIStack Wallet');
    expect(manifest.short_name).toBe('EUDIStack');
    expect(document.querySelector<HTMLMetaElement>("meta[name='apple-mobile-web-app-title']")?.content).toBe(
      'EUDIStack',
    );
  });

  it('reuses the existing iOS title meta instead of adding a second one', () => {
    const service = setup('DEV');

    (service as any).applyTheme(buildTheme({ name: 'EUDIStack' }));
    (service as any).applyTheme(buildTheme({ name: 'Other' }));

    const metas = document.querySelectorAll("meta[name='apple-mobile-web-app-title']");
    expect(metas).toHaveLength(1);
    expect((metas[0] as HTMLMetaElement).content).toBe('Other DEV');
  });

  it('falls back to the default names when the tenant has no branding name', async () => {
    const service = setup('DEV');

    (service as any).applyTheme(buildTheme({ name: '' }));

    const manifest = JSON.parse(await readBlob(manifestBlob as Blob));
    expect(manifest.name).toBe('EUDI Wallet (DEV)');
    expect(manifest.short_name).toBe('Wallet DEV');
    expect(document.querySelector("meta[name='apple-mobile-web-app-title']")).toBeNull();
  });
});
