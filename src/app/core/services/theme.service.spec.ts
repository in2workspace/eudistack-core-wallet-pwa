import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { ThemeService } from './theme.service';
import { ColorService } from '../../shared/services/color-service.service';
import { StorageService } from '../../shared/services/storage.service';
import { Theme } from '../models/theme.model';

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

  describe('isRelativeAssetPath', () => {
    const validate = (v: string) => (service as any).isRelativeAssetPath(v);

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
