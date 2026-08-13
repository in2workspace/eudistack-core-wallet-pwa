import { DOCUMENT } from '@angular/common';
import { Inject, Injectable, signal } from '@angular/core';
import { RuntimeTranslationPreference } from '../../core/models/ui-text-translation.model';

const STORAGE_KEY = 'eudistack-user-preferences';

export interface UserPreferences {
  privacyBlur: boolean;
  darkMode: boolean;
  /** EUD-142 — additive over the native language (US-02); never replaces it (AC-07). */
  uiTranslation: RuntimeTranslationPreference;
}

const DEFAULTS: UserPreferences = {
  privacyBlur: false,
  darkMode: false,
  uiTranslation: { enabled: false, targetLanguage: null },
};

@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly _privacyBlur = signal(DEFAULTS.privacyBlur);
  private readonly _darkMode = signal(DEFAULTS.darkMode);
  private readonly _uiTranslation = signal(DEFAULTS.uiTranslation);

  readonly privacyBlur = this._privacyBlur.asReadonly();
  readonly darkMode = this._darkMode.asReadonly();
  readonly uiTranslation = this._uiTranslation.asReadonly();

  constructor(@Inject(DOCUMENT) private readonly document: Document) {
    const saved = this.load();
    this._privacyBlur.set(saved.privacyBlur);
    this._darkMode.set(saved.darkMode);
    this._uiTranslation.set(saved.uiTranslation);
    this.applyDarkMode(saved.darkMode);
  }

  togglePrivacyBlur(): void {
    this._privacyBlur.update(v => !v);
    this.persist({ privacyBlur: this._privacyBlur() });
  }

  toggleDarkMode(): void {
    const next = !this._darkMode();
    this._darkMode.set(next);
    this.applyDarkMode(next);
    this.persist({ darkMode: next });
  }

  /** EUD-142 — activates/deactivates runtime UI translation, or changes its target language (AC-06). */
  setUiTranslation(pref: RuntimeTranslationPreference): void {
    this._uiTranslation.set(pref);
    this.persist({ uiTranslation: pref });
  }

  private applyDarkMode(enabled: boolean): void {
    this.document.documentElement.classList.toggle('dark-theme', enabled);
  }

  /**
   * Read-modify-write: rereads `localStorage` immediately before writing,
   * rather than serializing every in-memory signal, and merges only
   * `patch` on top (EC-10). Two writes from different tabs/instances that
   * touch *different* keys no longer clobber each other; a write to the
   * *same* key from two tabs is still last-write-wins, which is accepted
   * (§3.4.2 row 1) — this preference set is low-criticality and no
   * invariant depends on cross-tab ordering.
   */
  private persist(patch: Partial<UserPreferences>): void {
    const current = this.load();
    const next: UserPreferences = { ...current, ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
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
