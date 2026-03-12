import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, signal } from '@angular/core';

const STORAGE_KEY = 'eudistack-user-preferences';

interface UserPreferences {
  privacyBlur: boolean;
  darkMode: boolean;
}

const DEFAULTS: UserPreferences = {
  privacyBlur: false,
  darkMode: false,
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly _privacyBlur = signal(DEFAULTS.privacyBlur);
  private readonly _darkMode = signal(DEFAULTS.darkMode);

  readonly privacyBlur = this._privacyBlur.asReadonly();
  readonly darkMode = this._darkMode.asReadonly();

  constructor(@Inject(DOCUMENT) private readonly document: Document) {
    const saved = this.load();
    this._privacyBlur.set(saved.privacyBlur);
    this._darkMode.set(saved.darkMode);
    this.applyDarkMode(saved.darkMode);
  }

  togglePrivacyBlur(): void {
    this._privacyBlur.update(v => !v);
    this.persist();
  }

  toggleDarkMode(): void {
    const next = !this._darkMode();
    this._darkMode.set(next);
    this.applyDarkMode(next);
    this.persist();
  }

  private applyDarkMode(enabled: boolean): void {
    this.document.documentElement.classList.toggle('dark-theme', enabled);
  }

  private persist(): void {
    const prefs: UserPreferences = {
      privacyBlur: this._privacyBlur(),
      darkMode: this._darkMode(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  }

  private load(): UserPreferences {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...DEFAULTS, ...JSON.parse(raw) };
      }
    } catch { /* ignore corrupt data */ }
    return { ...DEFAULTS };
  }
}
