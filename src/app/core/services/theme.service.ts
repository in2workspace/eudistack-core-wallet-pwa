import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { Theme } from '../models/theme.model';
import { ColorService } from '../../shared/services/color-service.service';
import { StorageService } from '../../shared/services/storage.service';

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

  get tenantDomain(): string | null {
    return this.snapshot?.tenantDomain ?? null;
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
    const brandColors: Record<string, string> = {
      '--primary-color': theme.branding.primaryColor,
      '--primary-contrast-color': theme.branding.primaryContrastColor,
      '--secondary-color': theme.branding.secondaryColor,
      '--secondary-contrast-color': theme.branding.secondaryContrastColor,
    };

    // Filter out invalid color values to prevent CSS injection
    const colorMap: Record<string, string> = {};
    for (const [token, value] of Object.entries(brandColors)) {
      if (this.isValidCssColor(value)) {
        colorMap[token] = value;
      }
    }

    // Apply via ColorService (which also sets -rgb, -shade, -tint)
    this.colorService.applyCustomColors(colorMap);

    // ── Layer 1b: Per-context overrides (optional, fallback to Layer 1) ──
    this.applyContextTokens(theme, root);

    // Set RGB channels for status tokens (useful for rgba() usage)
    const rgbTokens = ['--status-error', '--status-success', '--status-warning'];
    for (const token of rgbTokens) {
      const value = root.style.getPropertyValue(token);
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

    this.updateManifest(theme);
  }

  private updateManifest(theme: Theme): void {
    const origin = window.location.origin;
    const manifest = {
      name: `${theme.branding.name || 'EUDI'} Wallet`,
      short_name: theme.branding.name || 'Wallet',
      theme_color: theme.branding.primaryColor,
      background_color: getComputedStyle(document.documentElement).getPropertyValue('--surface-page').trim(),
      display: 'standalone',
      scope: `${origin}/`,
      start_url: `${origin}/`,
      orientation: 'portrait',
      icons: theme.branding.pwaIconUrl && this.isRelativeAssetPath(theme.branding.pwaIconUrl)
        ? [
            { src: `${origin}/${theme.branding.pwaIconUrl}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${origin}/${theme.branding.pwaIconUrl}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${origin}/${theme.branding.pwaIconUrl}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ]
        : [
            { src: `${origin}/assets/icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${origin}/assets/icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${origin}/assets/icons/pwa-maskable-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
      screenshots: [
        { src: `${origin}/assets/screenshots/screenshot-wide.png`, sizes: '1280x720', type: 'image/png', form_factor: 'wide', label: `${theme.branding.name || 'EUDI'} Wallet` },
        { src: `${origin}/assets/screenshots/screenshot-mobile.png`, sizes: '540x720', type: 'image/png', label: `${theme.branding.name || 'EUDI'} Wallet` },
      ],
    };

    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (link) {
      link.href = url;
    }

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme.branding.primaryColor;
    }
  }

  /**
   * Apply optional per-context color overrides from theme.json branding.
   * Each token falls back to the base brand color if not specified.
   */
  /** Returns true if the value is a valid hex color (#RGB, #RRGGBB, #RRGGBBAA). */
  private isValidCssColor(value: string): boolean {
    return /^#[0-9a-fA-F]{3,8}$/.test(value.trim());
  }

  private applyContextTokens(theme: Theme, root: HTMLElement): void {
    const b = theme.branding;

    const contextMap: Record<string, string | undefined> = {
      // Credential card
      '--card-background': b.card?.background,
      '--card-gradient-end': b.card?.gradientEnd,
      '--card-text': b.card?.text,
      // Auth screens
      '--auth-background': b.auth?.background,
      '--auth-gradient-end': b.auth?.gradientEnd ?? b.auth?.background,
    };

    for (const [token, value] of Object.entries(contextMap)) {
      if (value && this.isValidCssColor(value)) {
        root.style.setProperty(token, value);
        root.style.setProperty(`${token}-rgb`, this.hexToRgbChannels(value));
      }
    }
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

  /** Returns true if the URL is a safe relative path (no external URLs). */
  private isRelativeAssetPath(url: string): boolean {
    return url.startsWith('assets/') || url.startsWith('/assets/');
  }

  private setFavicon(url: string): void {
    if (!this.isRelativeAssetPath(url)) return;

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
