import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventEmitter, signal } from '@angular/core';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { LanguageSelectorPage } from './language-selector.page';
import { StorageService } from 'src/app/shared/services/storage.service';
import { UiTextTranslationService } from 'src/app/core/services/ui-text-translation.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { UiTranslationStatus, UiTextKey } from 'src/app/core/models/ui-text-translation.model';

const translateServiceMock = {
  currentLang: 'es',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string) => key,
  get: jest.fn((key: string) => of(key)),
  getBrowserLang: jest.fn().mockReturnValue('es'),
};

const storageMock = {
  get: jest.fn().mockResolvedValue('es'),
  set: jest.fn(),
};

function createTranslationServiceMock() {
  return {
    status: signal<UiTranslationStatus>('idle'),
    targetLanguage: signal<string | null>(null),
    progress: signal<{ done: number; total: number } | null>(null),
    availableTargets: signal<readonly string[]>([]),
    probeAvailability: jest.fn().mockResolvedValue([]),
    restoreFromPreference: jest.fn().mockResolvedValue(undefined),
    activate: jest.fn().mockResolvedValue(undefined),
    deactivate: jest.fn(),
  };
}

async function createFixture(
  translationMock: ReturnType<typeof createTranslationServiceMock>,
  walletMode: 'browser' | 'server' = 'browser',
): Promise<ComponentFixture<LanguageSelectorPage>> {
  await TestBed.configureTestingModule({
    imports: [LanguageSelectorPage, TranslateModule.forRoot()],
    providers: [
      { provide: TranslateService, useValue: translateServiceMock },
      { provide: StorageService, useValue: storageMock },
      { provide: UiTextTranslationService, useValue: translationMock },
      // AC-09: the component never branches on wallet mode — provided only
      // so the parity tests below can assert identical behavior across modes.
      { provide: WalletDiscoveryService, useValue: { mode: jest.fn().mockReturnValue(walletMode) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(LanguageSelectorPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

describe('LanguageSelectorPage — runtime UI translation section (EUD-142)', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('lifecycle', () => {
    it('probes availability and restores the persisted preference on init', async () => {
      const translationMock = createTranslationServiceMock();

      await createFixture(translationMock);

      expect(translationMock.probeAvailability).toHaveBeenCalled();
      expect(translationMock.restoreFromPreference).toHaveBeenCalled();
    });
  });

  describe('unavailable state (EC-01, AC-01)', () => {
    it('hides the toggle and shows the explanatory hint, without degrading the native selector', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.status.set('unavailable');

      const fixture = await createFixture(translationMock);
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.translation-toggle-item')).toBeFalsy();
      expect(el.textContent).toContain('ui-translation.state-unavailable');
      expect(el.textContent).toContain('ui-translation.state-unavailable-hint');
      // Native language selector (US-02) is unaffected.
      expect(el.querySelector('.language-options')).toBeTruthy();
      expect(el.querySelectorAll('.language-card').length).toBe(3);
    });
  });

  describe('idle state with available targets (AC-01, AC-02)', () => {
    it('renders the toggle unchecked and the target-language selector', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el', 'ar']);

      const fixture = await createFixture(translationMock);
      const el: HTMLElement = fixture.nativeElement;
      const toggle = el.querySelector('ion-toggle.settings-toggle');

      expect(toggle).toBeTruthy();
      expect(toggle?.getAttribute('checked')).not.toBe('true');
      expect(el.querySelector('.translation-target-item')).toBeTruthy();
    });

    it('never checks the toggle by default (AC-01: never active by default)', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el']);

      const fixture = await createFixture(translationMock);

      expect(fixture.componentInstance.translationEnabled()).toBe(false);
    });

    it('hides the target-language selector when there are no available targets', async () => {
      const translationMock = createTranslationServiceMock();

      const fixture = await createFixture(translationMock);

      expect(fixture.nativeElement.querySelector('.translation-target-item')).toBeFalsy();
    });
  });

  describe('activation (AC-02, AC-06)', () => {
    it('activates the selected target language when the toggle is turned on', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el', 'ar']);
      const fixture = await createFixture(translationMock);

      fixture.componentInstance.selectedTargetLanguage = 'el';
      fixture.componentInstance.onTranslationToggle(true);

      expect(translationMock.activate).toHaveBeenCalledWith('el');
    });

    it('defaults to the first available target when none was explicitly chosen', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['ar', 'el']);
      const fixture = await createFixture(translationMock);

      fixture.componentInstance.onTranslationToggle(true);

      expect(translationMock.activate).toHaveBeenCalledWith('ar');
    });

    it('changing the target language while active re-activates with the new target', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el', 'ar']);
      translationMock.status.set('active');
      translationMock.targetLanguage.set('el');
      const fixture = await createFixture(translationMock);

      fixture.componentInstance.onTargetLanguageChange('ar');

      expect(translationMock.activate).toHaveBeenCalledWith('ar');
    });

    it('changing the target language while inactive only stores the selection, without activating', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el', 'ar']);
      const fixture = await createFixture(translationMock);

      fixture.componentInstance.onTargetLanguageChange('ar');

      expect(translationMock.activate).not.toHaveBeenCalled();
      expect(fixture.componentInstance.selectedTargetLanguage).toBe('ar');
    });
  });

  describe('deactivation (AC-05)', () => {
    it('deactivates immediately when the toggle is turned off', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.status.set('active');
      translationMock.targetLanguage.set('el');
      const fixture = await createFixture(translationMock);

      fixture.componentInstance.onTranslationToggle(false);

      expect(translationMock.deactivate).toHaveBeenCalled();
      expect(translationMock.activate).not.toHaveBeenCalled();
    });
  });

  describe('preparing state — progress (AC-11)', () => {
    it('shows a progress indicator and keeps the controls operable-but-disabled', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el']);
      translationMock.status.set('preparing');
      translationMock.progress.set({ done: 5, total: 20 });

      const fixture = await createFixture(translationMock);
      const el: HTMLElement = fixture.nativeElement;

      expect(el.querySelector('.translation-state--progress')).toBeTruthy();
      expect(el.textContent).toContain('ui-translation.state-preparing');
      const progressBar = el.querySelector('ion-progress-bar') as (HTMLElement & { value?: number }) | null;
      expect(progressBar?.value).toBe(0.25);
      expect(fixture.componentInstance.translationControlDisabled()).toBe(true);
    });
  });

  describe('error state — retry (ES-02, ES-04, ES-05)', () => {
    it('shows the error message and a retry action that re-activates the last target', async () => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el']);
      translationMock.status.set('error');
      translationMock.targetLanguage.set('el');
      const fixture = await createFixture(translationMock);
      fixture.componentInstance.selectedTargetLanguage = 'el';

      const el: HTMLElement = fixture.nativeElement;
      expect(el.querySelector('.translation-state--error')).toBeTruthy();
      expect(el.textContent).toContain('ui-translation.state-error');

      fixture.componentInstance.retryTranslation();

      expect(translationMock.activate).toHaveBeenCalledWith('el');
    });
  });

  describe('targetLanguageName (Intl.DisplayNames)', () => {
    it('returns a human-readable language name for a candidate code', async () => {
      const translationMock = createTranslationServiceMock();
      const fixture = await createFixture(translationMock);

      const name = fixture.componentInstance.targetLanguageName('el');

      expect(name.toLowerCase()).not.toBe('el');
      expect(name.length).toBeGreaterThan(0);
    });

    it('falls back to the raw code if Intl.DisplayNames throws', async () => {
      const translationMock = createTranslationServiceMock();
      const fixture = await createFixture(translationMock);
      const original = Intl.DisplayNames;
      Object.defineProperty(Intl, 'DisplayNames', {
        configurable: true,
        value: function () { throw new Error('unsupported'); },
      });

      expect(fixture.componentInstance.targetLanguageName('el')).toBe('el');

      Object.defineProperty(Intl, 'DisplayNames', { configurable: true, value: original });
    });
  });

  describe('EUDIW / EBW parity (AC-09)', () => {
    it.each(['browser', 'server'] as const)('renders and behaves identically in %s mode', async (mode) => {
      const translationMock = createTranslationServiceMock();
      translationMock.availableTargets.set(['el']);

      const fixture = await createFixture(translationMock, mode);

      expect(fixture.nativeElement.querySelector('.translation-toggle-item')).toBeTruthy();
      expect(fixture.componentInstance.translationEnabled()).toBe(false);

      fixture.componentInstance.onTranslationToggle(true);
      expect(translationMock.activate).toHaveBeenCalledWith('el');
    });
  });
});

describe('LanguageSelectorPage — native language cards', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function cards(fixture: ComponentFixture<LanguageSelectorPage>): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.language-card'));
  }

  it('renders one card per supported language and marks the stored one as selected', async () => {
    storageMock.get.mockResolvedValue('es');
    const fixture = await createFixture(createTranslationServiceMock());

    const [english, castellano, catala] = cards(fixture);
    expect([english, castellano, catala].map((c) => c.textContent!.trim()))
      .toEqual(['English', 'Castellano', 'Català']);

    expect(castellano.classList).toContain('language-card--selected');
    expect(castellano.getAttribute('aria-checked')).toBe('true');
    expect(english.classList).not.toContain('language-card--selected');
    expect(english.getAttribute('aria-checked')).toBe('false');
  });

  it('switching card applies the language, persists it and moves the selected state', async () => {
    storageMock.get.mockResolvedValue('es');
    const fixture = await createFixture(createTranslationServiceMock());

    cards(fixture)[0].dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(translateServiceMock.use).toHaveBeenCalledWith('en');
    expect(storageMock.set).toHaveBeenCalledWith('language', 'en');

    const [english, castellano] = cards(fixture);
    expect(english.classList).toContain('language-card--selected');
    expect(castellano.classList).not.toContain('language-card--selected');
  });

  it('the header back link returns to the credential list', async () => {
    const fixture = await createFixture(createTranslationServiceMock());
    const router = TestBed.inject(Router);
    const navigate = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const back: HTMLElement = fixture.nativeElement.querySelector('.back-link');
    expect(back).toBeTruthy();

    back.dispatchEvent(new MouseEvent('click'));

    expect(navigate).toHaveBeenCalledWith(['/tabs/credentials']);
  });
});
