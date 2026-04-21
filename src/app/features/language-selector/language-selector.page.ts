import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule,TranslateService } from '@ngx-translate/core';
import { StorageService } from 'src/app/shared/services/storage.service';
import { BehaviorSubject, distinctUntilChanged, shareReplay } from 'rxjs';

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
  }

  public languageChange(code: string) {
    if (!code) return;

    this.languages.next(code);
    this.translate.use(code);
    this.storageService.set('language', code);
  }
}
