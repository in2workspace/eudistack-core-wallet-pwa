import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule,TranslateService } from '@ngx-translate/core';
import { StorageService } from 'src/app/shared/services/storage.service';
import { BehaviorSubject, distinctUntilChanged, shareReplay } from 'rxjs';
import { UiTextTranslationService } from 'src/app/core/services/ui-text-translation.service';
import { LanguageTag } from 'src/app/core/models/ui-text-translation.model';

@Component({
    selector: 'app-language-selector',
    templateUrl: './language-selector.page.html',
    styleUrls: ['./language-selector.page.scss'],
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class LanguageSelectorPage implements OnInit {
  public translate = inject(TranslateService);

  public selected = { name: '', code: '' };
  public language = { name: '', code: '' };
  public languages = new BehaviorSubject<string>('');

  public languageList = [
    {
      name: 'English',
      code: 'en',
    },
    {
      name: 'Castellano',
      code: 'es',
    },
    {
      name: 'Català',
      code: 'ca',
    },
  ];

  public languageSelected = this.languages.pipe(
    distinctUntilChanged(),
    shareReplay(1)
  );

  private storageService = inject(StorageService);

  // --- EUD-142: runtime UI translation section ------------------------------

  /** Orchestrator — same instance regardless of wallet mode (AC-09: no mode branching anywhere in this Story). */
  public readonly uiTranslation = inject(UiTextTranslationService);

  public readonly translationStatus = this.uiTranslation.status;
  public readonly translationProgress = this.uiTranslation.progress;
  public readonly availableTargets = this.uiTranslation.availableTargets;

  /** Toggle checked state: on while preparing or active — off while idle/unavailable/error. */
  public readonly translationEnabled = computed(() =>
    this.translationStatus() === 'active' || this.translationStatus() === 'preparing');

  /** Control disabled while probing/preparing (EC-07) or when the engine is unsupported (AC-01). */
  public readonly translationControlDisabled = computed(() => {
    const status = this.translationStatus();
    return status === 'probing' || status === 'preparing' || status === 'unavailable';
  });

  public selectedTargetLanguage: LanguageTag | null = null;

  public ngOnInit() {
    this.storageService.get('language').then((datos) => {
      this.languages.next((datos as string) ?? this.translate.currentLang ?? this.languageList[2].code);
    });
    const lang = this.languageList.forEach((language) => {
      if (language.code === this.translate.currentLang) {
        this.selected = language;
      }
    });
    if (lang != undefined) this.selected = lang;
    if (this.translate.currentLang == undefined)
      this.selected = this.languageList[2];

    void this.uiTranslation.probeAvailability();
    this.selectedTargetLanguage = this.uiTranslation.targetLanguage();
    void this.uiTranslation.restoreFromPreference();
  }

  public languageChange(code: string) {
    if (!code) return;

    this.languages.next(code);
    this.translate.use(code);
    this.storageService.set('language', code);
  }

  /** Human-readable target-language name in the currently displayed language (task 16: `Intl.DisplayNames`). */
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
}
