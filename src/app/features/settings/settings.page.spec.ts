import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { signal } from '@angular/core';
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

    const uiTranslation = {
      status: signal('idle'),
      progress: signal(null),
      availableTargets: signal([]),
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
});
