import { ChangeDetectorRef, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BehaviorSubject, distinctUntilChanged, shareReplay } from 'rxjs';
import { StorageService } from 'src/app/shared/services/storage.service';
import { UserPreferencesService } from 'src/app/shared/services/user-preferences.service';
import { CameraService } from 'src/app/shared/services/camera.service';
import { UiTextTranslationService } from 'src/app/core/services/ui-text-translation.service';
import { LanguageTag } from 'src/app/core/models/ui-text-translation.model';

type SettingsPanelId = 'language' | 'theme' | 'camera';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  imports: [IonicModule, CommonModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class SettingsPage implements OnInit {
  public readonly translate = inject(TranslateService);
  public readonly prefs = inject(UserPreferencesService);
  public readonly cameraService = inject(CameraService);
  public readonly uiTranslation = inject(UiTextTranslationService);

  public readonly languageList = [
    { name: 'English', code: 'en' },
    { name: 'Castellano', code: 'es' },
    { name: 'Català', code: 'ca' },
  ];

  public readonly expandedPanel = signal<SettingsPanelId | null>(null);

  public readonly translationStatus = this.uiTranslation.status;
  public readonly translationProgress = this.uiTranslation.progress;
  public readonly availableTargets = this.uiTranslation.availableTargets;

  public readonly translationEnabled = computed(() =>
    this.translationStatus() === 'active' || this.translationStatus() === 'preparing');

  public readonly translationControlDisabled = computed(() => {
    const status = this.translationStatus();
    return status === 'probing' || status === 'preparing' || status === 'unavailable';
  });

  public readonly availableDevices$ = this.cameraService.availableDevices$;
  public readonly selectedDevice$ = this.cameraService.selectedCamera$;

  public selectedTargetLanguage: LanguageTag | null = null;
  public isChangingDevice = false;

  private readonly languages = new BehaviorSubject<string>('');
  public readonly languageSelected = this.languages.pipe(distinctUntilChanged(), shareReplay(1));

  private readonly storageService = inject(StorageService);
  private readonly router = inject(Router);
  private readonly cdr = inject(ChangeDetectorRef);

  public ngOnInit(): void {
    this.storageService.get('language').then((stored) => {
      this.languages.next((stored as string) ?? this.translate.currentLang ?? this.languageList[2].code);
    });

    void this.uiTranslation.probeAvailability();
    this.selectedTargetLanguage = this.uiTranslation.targetLanguage();
    void this.uiTranslation.restoreFromPreference();
  }

  public backToWallet(): void {
    void this.router.navigate(['/tabs/credentials']);
  }

  public isExpanded(panel: SettingsPanelId): boolean {
    return this.expandedPanel() === panel;
  }

  public togglePanel(panel: SettingsPanelId): void {
    this.expandedPanel.set(this.isExpanded(panel) ? null : panel);
  }

  public languageChange(code: string): void {
    if (!code) return;

    this.languages.next(code);
    this.translate.use(code);
    this.storageService.set('language', code);
  }

  public targetLanguageName(code: LanguageTag): string {
    try {
      return new Intl.DisplayNames([this.translate.currentLang], { type: 'language' }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  public onTranslationToggle(checked: boolean): void {
    if (checked) {
      const target = this.selectedTargetLanguage ?? this.availableTargets()[0];
      if (target) {
        this.selectedTargetLanguage = target;
        void this.uiTranslation.activate(target);
      }
      return;
    }
    this.uiTranslation.deactivate();
  }

  public onTargetLanguageChange(code: LanguageTag): void {
    this.selectedTargetLanguage = code;
    if (this.translationEnabled()) {
      void this.uiTranslation.activate(code);
    }
  }

  public retryTranslation(): void {
    const target = this.selectedTargetLanguage ?? this.uiTranslation.targetLanguage() ?? this.availableTargets()[0];
    if (target) {
      void this.uiTranslation.activate(target);
    }
  }

  public async onDeviceSelectChange(selectedDeviceId: string): Promise<void> {
    this.showIsChangingDeviceTemp();

    const availableDevices = await this.cameraService.updateAvailableCameras();
    if (availableDevices.length === 0) {
      console.error('Settings: available devices is empty');
      this.handleCameraError();
      return;
    }

    if (this.cameraService.isCameraAvailableById(selectedDeviceId)) {
      this.cameraService.setCamera(this.cameraService.getAvailableCameraById(selectedDeviceId));
      return;
    }

    console.error('Settings: error when trying to get camera by id');
    this.handleCameraError();
  }

  public handleCameraError(): void {
    this.cameraService.handleCameraErrors({ name: 'CustomNoAvailable' }, 'fetchError');
  }

  private showIsChangingDeviceTemp(): void {
    this.isChangingDevice = true;
    setTimeout(() => {
      this.isChangingDevice = false;
      this.cdr.detectChanges();
    }, 2000);
  }
}
