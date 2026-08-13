import { TestBed } from '@angular/core/testing';
import { UserPreferencesService } from './user-preferences.service';

const STORAGE_KEY = 'eudistack-user-preferences';

// Each call gets a fresh injector/service instance sharing the same
// localStorage — models two tabs/instances of the app for the EC-10 tests.
function createService(): UserPreferencesService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  return TestBed.inject(UserPreferencesService);
}

describe('UserPreferencesService', () => {
  afterEach(() => {
    localStorage.clear();
  });

  describe('defaults', () => {
    it('defaults uiTranslation to disabled with no target language (AC-07)', () => {
      const service = createService();

      expect(service.uiTranslation()).toEqual({ enabled: false, targetLanguage: null });
    });

    it('keeps existing privacyBlur/darkMode defaults intact', () => {
      const service = createService();

      expect(service.privacyBlur()).toBe(false);
      expect(service.darkMode()).toBe(false);
    });
  });

  describe('backward compatibility with pre-EUD-142 saved profiles', () => {
    it('spreads DEFAULTS.uiTranslation over a profile saved before this Story existed', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ privacyBlur: true, darkMode: true }));

      const service = createService();

      expect(service.privacyBlur()).toBe(true);
      expect(service.darkMode()).toBe(true);
      expect(service.uiTranslation()).toEqual({ enabled: false, targetLanguage: null });
    });
  });

  describe('setUiTranslation (AC-06)', () => {
    it('updates the signal and persists the preference', () => {
      const service = createService();

      service.setUiTranslation({ enabled: true, targetLanguage: 'el' });

      expect(service.uiTranslation()).toEqual({ enabled: true, targetLanguage: 'el' });
      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(persisted.uiTranslation).toEqual({ enabled: true, targetLanguage: 'el' });
    });

    it('persists across a fresh service instance (session persistence, AC-06)', () => {
      const first = createService();
      first.setUiTranslation({ enabled: true, targetLanguage: 'ar' });

      const second = createService();

      expect(second.uiTranslation()).toEqual({ enabled: true, targetLanguage: 'ar' });
    });
  });

  describe('read-modify-write persist (EC-10)', () => {
    it('does not clobber a uiTranslation change persisted by another instance when toggling privacyBlur', () => {
      const tabA = createService();
      const tabB = createService();

      // Both tabs start from the same loaded snapshot; tabB persists a change
      // to a *different* key than the one tabA is about to change.
      tabB.setUiTranslation({ enabled: true, targetLanguage: 'el' });
      tabA.togglePrivacyBlur();

      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(persisted.privacyBlur).toBe(true);
      // tabA's persist() re-read localStorage right before writing, so
      // tabB's uiTranslation change survives instead of being overwritten
      // by tabA's stale in-memory uiTranslation default.
      expect(persisted.uiTranslation).toEqual({ enabled: true, targetLanguage: 'el' });
    });

    it('does not clobber a darkMode change persisted by another instance when setting uiTranslation', () => {
      const tabA = createService();
      const tabB = createService();

      tabB.toggleDarkMode();
      tabA.setUiTranslation({ enabled: true, targetLanguage: 'ja' });

      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(persisted.darkMode).toBe(true);
      expect(persisted.uiTranslation).toEqual({ enabled: true, targetLanguage: 'ja' });
    });

    it('last-write-wins on the SAME key across instances (accepted, §3.4.2 row 1)', () => {
      const tabA = createService();
      const tabB = createService();

      tabA.setUiTranslation({ enabled: true, targetLanguage: 'el' });
      tabB.setUiTranslation({ enabled: true, targetLanguage: 'ar' });

      const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
      expect(persisted.uiTranslation).toEqual({ enabled: true, targetLanguage: 'ar' });
    });
  });

  describe('existing behavior unaffected', () => {
    it('togglePrivacyBlur flips the signal and persists it', () => {
      const service = createService();

      service.togglePrivacyBlur();

      expect(service.privacyBlur()).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).privacyBlur).toBe(true);
    });

    it('toggleDarkMode flips the signal, applies the class, and persists it', () => {
      const service = createService();

      service.toggleDarkMode();

      expect(service.darkMode()).toBe(true);
      expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).darkMode).toBe(true);
    });
  });

  describe('corrupt saved data', () => {
    it('falls back to defaults when localStorage holds invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{not-json');

      const service = createService();

      expect(service.uiTranslation()).toEqual({ enabled: false, targetLanguage: null });
      expect(service.privacyBlur()).toBe(false);
    });
  });
});
