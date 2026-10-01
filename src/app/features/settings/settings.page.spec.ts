import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { WritableSignal, signal } from '@angular/core';
import { SettingsPage } from './settings.page';
import { StorageService } from 'src/app/shared/services/storage.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { CameraService } from 'src/app/shared/services/camera.service';
import { UiTextTranslationService } from 'src/app/core/services/ui-text-translation.service';

describe('SettingsPage', () => {
  let component: SettingsPage;
  let fixture: ComponentFixture<SettingsPage>;
  let router: { navigate: jest.Mock };
  let storage: { get: jest.Mock; set: jest.Mock };
  let prefs: { darkMode: jest.Mock; toggleDarkMode: jest.Mock };
  let camera: Record<string, jest.Mock | unknown>;
  let translateUse: jest.SpyInstance;
  let uiTranslation: {
    status: WritableSignal<string>;
    progress: WritableSignal<unknown>;
    availableTargets: WritableSignal<string[]>;
    targetLanguage: jest.Mock;
    probeAvailability: jest.Mock;
    restoreFromPreference: jest.Mock;
    activate: jest.Mock;
    deactivate: jest.Mock;
  };

  beforeEach(async () => {
    router = { navigate: jest.fn().mockResolvedValue(true) };
    storage = { get: jest.fn().mockResolvedValue('es'), set: jest.fn() };
    prefs = { darkMode: jest.fn().mockReturnValue(false), toggleDarkMode: jest.fn() };

    camera = {
      availableDevices$: signal([{ deviceId: 'cam-1', label: 'Front' }]),
      selectedCamera$: signal({ deviceId: 'cam-1', label: 'Front' }),
      updateAvailableCameras: jest.fn().mockResolvedValue([{ deviceId: 'cam-1' }]),
      isCameraAvailableById: jest.fn().mockReturnValue(true),
      getAvailableCameraById: jest.fn().mockReturnValue({ deviceId: 'cam-1' }),
      setCamera: jest.fn(),
      handleCameraErrors: jest.fn(),
    };

    uiTranslation = {
      status: signal<string>('idle'),
      progress: signal<unknown>(null),
      availableTargets: signal<string[]>([]),
      targetLanguage: jest.fn().mockReturnValue(null),
      probeAvailability: jest.fn().mockResolvedValue(undefined),
      restoreFromPreference: jest.fn().mockResolvedValue(undefined),
      activate: jest.fn(),
      deactivate: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [SettingsPage, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: StorageService, useValue: storage },
        { provide: UserPreferencesService, useValue: prefs },
        { provide: CameraService, useValue: camera },
        { provide: UiTextTranslationService, useValue: uiTranslation },
      ],
    }).compileComponents();

    translateUse = jest.spyOn(TestBed.inject(TranslateService), 'use');

    fixture = TestBed.createComponent(SettingsPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('starts with every panel collapsed', () => {
    expect(component.expandedPanel()).toBeNull();
    expect(component.isExpanded('language')).toBe(false);
    expect(component.isExpanded('theme')).toBe(false);
    expect(component.isExpanded('camera')).toBe(false);
  });

  it('opens a panel and closes it when toggled twice', () => {
    component.togglePanel('theme');
    expect(component.isExpanded('theme')).toBe(true);

    component.togglePanel('theme');
    expect(component.isExpanded('theme')).toBe(false);
  });

  it('keeps at most one panel open at a time', () => {
    component.togglePanel('language');
    component.togglePanel('camera');

    expect(component.isExpanded('camera')).toBe(true);
    expect(component.isExpanded('language')).toBe(false);
  });

  it('persists the language and applies it on change', () => {
    component.languageChange('en');

    expect(translateUse).toHaveBeenCalledWith('en');
    expect(storage.set).toHaveBeenCalledWith('language', 'en');
  });

  it('renders the language options as a native radio group', () => {
    component.togglePanel('language');
    fixture.detectChanges();

    const radios: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.language-options input[type="radio"]')
    );

    expect(radios).toHaveLength(component.languageList.length);
    expect(new Set(radios.map((radio) => radio.name)).size).toBe(1);
  });

  it('applies the language picked from the radio group', () => {
    component.togglePanel('language');
    fixture.detectChanges();

    const radios: HTMLInputElement[] = Array.from(
      fixture.nativeElement.querySelectorAll('.language-options input[type="radio"]')
    );
    radios.find((radio) => radio.value === 'en')?.click();

    expect(translateUse).toHaveBeenCalledWith('en');
    expect(storage.set).toHaveBeenCalledWith('language', 'en');
  });

  describe('mutual exclusion between native languages and automatic translation', () => {
    it('deactivates an active translation before applying the picked native language', () => {
      uiTranslation.status.set('active');

      component.languageChange('ca');

      expect(uiTranslation.deactivate).toHaveBeenCalledTimes(1);
      expect(uiTranslation.deactivate.mock.invocationCallOrder[0]).toBeLessThan(translateUse.mock.invocationCallOrder[0]);
      expect(translateUse).toHaveBeenCalledWith('ca');
    });

    it('deactivates a translation that is still preparing when a native language is picked', () => {
      uiTranslation.status.set('preparing');

      component.languageChange('en');

      expect(uiTranslation.deactivate).toHaveBeenCalledTimes(1);
      expect(translateUse).toHaveBeenCalledWith('en');
    });

    it('does not deactivate anything when translation is off', () => {
      uiTranslation.status.set('idle');

      component.languageChange('en');

      expect(uiTranslation.deactivate).not.toHaveBeenCalled();
      expect(translateUse).toHaveBeenCalledWith('en');
    });

    it('shows a native language card as selected while translation is off', async () => {
      component.togglePanel('language');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const checked = fixture.nativeElement.querySelectorAll('.language-card--selected');

      expect(checked).toHaveLength(1);
    });

    it('shows no native language card as selected while translation is active', async () => {
      uiTranslation.status.set('active');
      component.togglePanel('language');
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const checked = fixture.nativeElement.querySelectorAll('.language-card--selected');

      expect(checked).toHaveLength(0);
    });
  });

  it('ignores an empty language code', () => {
    component.languageChange('');

    expect(translateUse).not.toHaveBeenCalled();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it('sets the chosen camera when it is available', async () => {
    await component.onDeviceSelectChange('cam-1');

    expect(camera['setCamera']).toHaveBeenCalledWith({ deviceId: 'cam-1' });
    expect(camera['handleCameraErrors']).not.toHaveBeenCalled();
  });

  it('reports a camera error when no device is available', async () => {
    (camera['updateAvailableCameras'] as jest.Mock).mockResolvedValueOnce([]);

    await component.onDeviceSelectChange('cam-1');

    expect(camera['handleCameraErrors']).toHaveBeenCalled();
    expect(camera['setCamera']).not.toHaveBeenCalled();
  });

  it('reports a camera error when the chosen id is not available', async () => {
    (camera['isCameraAvailableById'] as jest.Mock).mockReturnValueOnce(false);

    await component.onDeviceSelectChange('ghost');

    expect(camera['handleCameraErrors']).toHaveBeenCalled();
    expect(camera['setCamera']).not.toHaveBeenCalled();
  });

  it('goes back to the credentials tab', () => {
    component.backToWallet();

    expect(router.navigate).toHaveBeenCalledWith(['/tabs/credentials']);
  });

  describe('stored language resolution', () => {
    const latestLanguage = (): string | undefined => {
      let value: string | undefined;
      component.languageSelected.subscribe((code) => (value = code)).unsubscribe();
      return value;
    };

    it('falls back to the active translate language when nothing is stored', async () => {
      storage.get.mockResolvedValueOnce(null);
      TestBed.inject(TranslateService).currentLang = 'en';

      component.ngOnInit();
      await Promise.resolve();

      expect(latestLanguage()).toBe('en');
    });

    it('falls back to Catalan when there is neither stored nor active language', async () => {
      storage.get.mockResolvedValueOnce(null);
      TestBed.inject(TranslateService).currentLang = undefined as unknown as string;

      component.ngOnInit();
      await Promise.resolve();

      expect(latestLanguage()).toBe('ca');
    });
  });

  describe('targetLanguageName', () => {
    it('resolves the display name through Intl', () => {
      const of = jest.fn().mockReturnValue('English');
      const spy = jest
        .spyOn(Intl, 'DisplayNames')
        .mockImplementation(() => ({ of }) as unknown as Intl.DisplayNames);

      expect(component.targetLanguageName('en')).toBe('English');
      expect(of).toHaveBeenCalledWith('en');

      spy.mockRestore();
    });

    it('returns the raw code when Intl has no name for it', () => {
      const spy = jest
        .spyOn(Intl, 'DisplayNames')
        .mockImplementation(() => ({ of: () => undefined }) as unknown as Intl.DisplayNames);

      expect(component.targetLanguageName('zz')).toBe('zz');

      spy.mockRestore();
    });

    it('returns the raw code when Intl throws on an invalid tag', () => {
      const spy = jest.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
        throw new RangeError('invalid tag');
      });

      expect(component.targetLanguageName('not-a-tag')).toBe('not-a-tag');

      spy.mockRestore();
    });
  });

  describe('translation toggle', () => {
    it('activates the first available target when none was chosen yet', () => {
      uiTranslation.availableTargets.set(['en', 'fr']);

      component.onTranslationToggle(true);

      expect(component.selectedTargetLanguage).toBe('en');
      expect(uiTranslation.activate).toHaveBeenCalledWith('en');
    });

    it('keeps the already chosen target when switching on', () => {
      uiTranslation.availableTargets.set(['en', 'fr']);
      component.selectedTargetLanguage = 'fr';

      component.onTranslationToggle(true);

      expect(uiTranslation.activate).toHaveBeenCalledWith('fr');
    });

    it('does nothing when switching on with no target available', () => {
      uiTranslation.availableTargets.set([]);

      component.onTranslationToggle(true);

      expect(uiTranslation.activate).not.toHaveBeenCalled();
      expect(component.selectedTargetLanguage).toBeNull();
    });

    it('deactivates when switched off', () => {
      component.onTranslationToggle(false);

      expect(uiTranslation.deactivate).toHaveBeenCalled();
      expect(uiTranslation.activate).not.toHaveBeenCalled();
    });
  });

  describe('cancelTranslation', () => {
    it('deactivates the translation that is being prepared', () => {
      component.cancelTranslation();

      expect(uiTranslation.deactivate).toHaveBeenCalledTimes(1);
    });

    it('renders the cancel button only while the translation is preparing', () => {
      component.togglePanel('language');
      uiTranslation.availableTargets.set(['fr']);
      uiTranslation.status.set('idle');
      fixture.detectChanges();
      const idleButtons = fixture.nativeElement.querySelectorAll('.translation-state--progress ion-button');

      uiTranslation.status.set('preparing');
      fixture.detectChanges();
      const preparingButtons = fixture.nativeElement.querySelectorAll('.translation-state--progress ion-button');

      expect(idleButtons).toHaveLength(0);
      expect(preparingButtons).toHaveLength(1);
    });
  });

  describe('onTargetLanguageChange', () => {
    it('re-activates with the new target while translation is running', () => {
      uiTranslation.status.set('active');

      component.onTargetLanguageChange('fr');

      expect(component.selectedTargetLanguage).toBe('fr');
      expect(uiTranslation.activate).toHaveBeenCalledWith('fr');
    });

    it('only records the target while translation is off', () => {
      uiTranslation.status.set('idle');

      component.onTargetLanguageChange('fr');

      expect(component.selectedTargetLanguage).toBe('fr');
      expect(uiTranslation.activate).not.toHaveBeenCalled();
    });
  });

  describe('retryTranslation', () => {
    it('retries with the chosen target', () => {
      component.selectedTargetLanguage = 'fr';

      component.retryTranslation();

      expect(uiTranslation.activate).toHaveBeenCalledWith('fr');
    });

    it('falls back to the target remembered by the service', () => {
      component.selectedTargetLanguage = null;
      uiTranslation.targetLanguage.mockReturnValue('de');

      component.retryTranslation();

      expect(uiTranslation.activate).toHaveBeenCalledWith('de');
    });

    it('falls back to the first available target', () => {
      component.selectedTargetLanguage = null;
      uiTranslation.targetLanguage.mockReturnValue(null);
      uiTranslation.availableTargets.set(['it']);

      component.retryTranslation();

      expect(uiTranslation.activate).toHaveBeenCalledWith('it');
    });

    it('does nothing when there is no target at all', () => {
      component.selectedTargetLanguage = null;
      uiTranslation.targetLanguage.mockReturnValue(null);
      uiTranslation.availableTargets.set([]);

      component.retryTranslation();

      expect(uiTranslation.activate).not.toHaveBeenCalled();
    });
  });

  it('clears the camera-switching flag once the grace period elapses', async () => {
    jest.useFakeTimers();
    try {
      const pending = component.onDeviceSelectChange('cam-1');
      expect(component.isChangingDevice).toBe(true);

      await pending;
      jest.advanceTimersByTime(2000);

      expect(component.isChangingDevice).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
});
