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

  private applyTheme(theme: Theme): void {
    const cssVarMap: Record<string, string> = {
      '--primary-color': theme.branding.primaryColor,
      '--primary-contrast-color': theme.branding.primaryContrastColor,
      '--secondary-color': theme.branding.secondaryColor,
      '--secondary-contrast-color': theme.branding.secondaryContrastColor,
    };

    this.colorService.applyCustomColors(cssVarMap);

    if (theme.branding.name) {
      document.title = theme.branding.name;
    }

    if (theme.branding.faviconUrl) {
      this.setFavicon(theme.branding.faviconUrl);
    }
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
