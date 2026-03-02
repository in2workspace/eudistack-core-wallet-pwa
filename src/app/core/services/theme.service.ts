import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { Theme } from '../models/theme.model';
import { ColorService } from '../../shared/services/color-service.service';
import { StorageService } from '../../shared/services/storage.service';

/**
 * Semantic design tokens — neutral, brand-independent values for the content area.
 * Brand colors (from theme.json) only apply to header/footer chrome.
 */
const SEMANTIC_DEFAULTS: Record<string, string> = {
  // Surfaces
  '--surface-page': '#F5F7FA',
  '--surface-card': '#FFFFFF',
  '--surface-muted': '#E8ECF1',

  // Text
  '--text-primary': '#1A1A2E',
  '--text-secondary': '#6B7280',
  '--text-disabled': '#9CA3AF',

  // Borders
  '--border-default': '#D1D5DB',
  '--border-strong': '#9CA3AF',

  // Actions — always neutral, NEVER derived from tenant brand
  '--action-primary': '#2563EB',
  '--action-primary-hover': '#1D4ED8',
  '--action-primary-contrast': '#FFFFFF',
  '--action-secondary': '#F3F4F6',
  '--action-secondary-hover': '#E5E7EB',
  '--action-secondary-text': '#374151',

  // Status
  '--status-success': '#059669',
  '--status-warning': '#D97706',
  '--status-error': '#DC2626',
  '--status-info': '#2563EB',
  '--status-neutral': '#6B7280',

  // Radii
  '--radius-sm': '4px',
  '--radius-md': '8px',
  '--radius-lg': '16px',
  '--radius-full': '9999px',

  // Shadows
  '--shadow-sm': '0 1px 2px rgba(0,0,0,0.05)',
  '--shadow-md': '0 4px 6px rgba(0,0,0,0.07)',
  '--shadow-lg': '0 10px 15px rgba(0,0,0,0.1)',
};

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private theme$ = new BehaviorSubject<Theme | null>(null);

  constructor(
    private http: HttpClient,
    private translate: TranslateService,
    private colorService: ColorService,
    private storageService: StorageService
  ) {}

  async load(): Promise<void> {
    const theme = await firstValueFrom(this.http.get<Theme>('/assets/theme.json'));
    this.theme$.next(theme);
    this.applyTheme(theme);
    await this.setupI18n(theme);
  }

  getTheme(): Observable<Theme | null> {
    return this.theme$.asObservable();
  }

  get snapshot(): Theme | null {
    return this.theme$.value;
  }

  getLogoUrl(variant: 'light' | 'dark'): string | null {
    const branding = this.snapshot?.branding;
    if (!branding) return null;
    if (variant === 'dark') return branding.logoDarkUrl ?? branding.logoUrl;
    return branding.logoUrl;
  }

  private applyTheme(theme: Theme): void {
    const root = document.documentElement;

    // ── Layer 1: Brand tokens (header/footer chrome only) ──
    const brandMap: Record<string, string> = {
      '--brand-primary': theme.branding.primaryColor,
      '--brand-primary-contrast': theme.branding.primaryContrastColor,
      '--brand-secondary': theme.branding.secondaryColor,
      '--brand-secondary-contrast': theme.branding.secondaryContrastColor,
    };

    // Backward-compatible aliases so existing CSS keeps working
    const legacyMap: Record<string, string> = {
      '--primary-color': theme.branding.primaryColor,
      '--primary-contrast-color': theme.branding.primaryContrastColor,
      '--secondary-color': theme.branding.secondaryColor,
      '--secondary-contrast-color': theme.branding.secondaryContrastColor,
    };

    // Apply brand + legacy via ColorService (which also sets -rgb, -shade, -tint)
    this.colorService.applyCustomColors({ ...brandMap, ...legacyMap });

    // ── Layer 2: Semantic tokens (content area) ──
    const actionPrimary = this.computeActionPrimary(theme.branding.primaryColor);

    for (const [token, value] of Object.entries(SEMANTIC_DEFAULTS)) {
      root.style.setProperty(token, value);
    }

    // Override action-primary if the brand hue is "safe" (blue range)
    root.style.setProperty('--action-primary', actionPrimary);
    root.style.setProperty('--action-primary-rgb', this.hexToRgbChannels(actionPrimary));

    // Set RGB channels for status tokens (useful for rgba() usage)
    const rgbTokens = ['--status-error', '--status-success', '--status-warning', '--action-primary'];
    for (const token of rgbTokens) {
      const value = root.style.getPropertyValue(token) || SEMANTIC_DEFAULTS[token];
      if (value) {
        root.style.setProperty(`${token}-rgb`, this.hexToRgbChannels(value));
      }
    }

    // Title & favicon
    if (theme.branding.name) {
      document.title = theme.branding.name;
    }
    if (theme.branding.faviconUrl) {
      this.setFavicon(theme.branding.faviconUrl);
    }
  }

  /**
   * If the tenant's primaryColor hue falls in a "safe" blue range (200–280)
   * AND has sufficient lightness (35–65%), use it as action-primary.
   * Otherwise keep the neutral default (#2563EB).
   */
  private computeActionPrimary(brandHex: string): string {
    const hsl = this.hexToHsl(brandHex);
    if (!hsl) return SEMANTIC_DEFAULTS['--action-primary'];

    const hueOk = hsl.h >= 200 && hsl.h <= 280;
    const lightnessOk = hsl.l >= 0.35 && hsl.l <= 0.65;

    return hueOk && lightnessOk ? brandHex : SEMANTIC_DEFAULTS['--action-primary'];
  }

  private hexToHsl(hex: string): { h: number; s: number; l: number } | null {
    const raw = hex.replace('#', '').trim();
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    const value = Number.parseInt(full, 16);
    if (Number.isNaN(value)) return null;

    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    const l = (max + min) / 2;

    if (d === 0) return { h: 0, s: 0, l };

    const s = d / (1 - Math.abs(2 * l - 1));

    let h = 0;
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;

    return { h, s, l };
  }

  private hexToRgbChannels(hex: string): string {
    const raw = hex.replace('#', '').trim();
    const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
    const value = Number.parseInt(full, 16);
    return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
  }

  private async setupI18n(theme: Theme): Promise<void> {
    if (!theme.i18n) return;

    this.translate.addLangs(theme.i18n.available);
    this.translate.setDefaultLang(theme.i18n.defaultLang);

    const storedLang = await this.storageService.get('language');
    if (storedLang && theme.i18n.available.includes(storedLang)) {
      this.translate.use(storedLang);
      return;
    }

    const browserLang = this.detectBrowserLanguage(theme.i18n.available);
    this.translate.use(browserLang ?? theme.i18n.defaultLang);
  }

  private detectBrowserLanguage(available: string[]): string | undefined {
    const browserLanguages = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];

    for (const lang of browserLanguages) {
      const shortLang = lang.split('-')[0];
      if (available.includes(shortLang)) {
        return shortLang;
      }
    }
    return undefined;
  }

  private setFavicon(url: string): void {
    let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = url;

    let appleLink = document.querySelector<HTMLLinkElement>("link[rel='apple-touch-icon']");
    if (!appleLink) {
      appleLink = document.createElement('link');
      appleLink.rel = 'apple-touch-icon';
      document.head.appendChild(appleLink);
    }
    appleLink.href = url;
  }
}
