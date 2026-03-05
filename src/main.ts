import { APP_INITIALIZER, enableProdMode, importProvidersFrom, isDevMode } from '@angular/core';
import { provideServiceWorker } from '@angular/service-worker';
import { bootstrapApplication } from '@angular/platform-browser';
import { RouteReuseStrategy, provideRouter } from '@angular/router';
import { IonicModule, IonicRouteStrategy } from '@ionic/angular';
import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import {
  HTTP_INTERCEPTORS,
  HttpClient,
  provideHttpClient,
  withInterceptors,
  withInterceptorsFromDi,
} from '@angular/common/http';
import { IonicStorageModule } from '@ionic/storage-angular';
import { HttpErrorInterceptor } from './app/core/interceptors/error-handler.interceptor';
import { authInterceptor } from './app/core/interceptors/auth.interceptor';
import { disableTouchScrollOnPaths } from './app/shared/helpers/disable-touch-scroll-on-paths';
import { httpTranslateLoader } from './app/shared/helpers/http-translate-loader';
import { KEY_STORAGE_PROVIDERS } from './app/core/spi-impl/key-storage.provider.factory';
import { AUTH_SERVICE_PROVIDER } from './app/core/services/auth.service';
import { ThemeService } from './app/core/services/theme.service';
import { PasskeyStoreService } from './app/core/services/passkey-store.service';

function initializeTheme(themeService: ThemeService): () => Promise<void> {
  return () => themeService.load();
}

function initializePasskeyStore(store: PasskeyStoreService): () => Promise<void> {
  return () => store.init();
}

disableTouchScrollOnPaths(
  ['/tabs/settings', '/tabs/home']
);

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    importProvidersFrom(
      IonicModule.forRoot({ innerHTMLTemplatesEnabled: true })
    ),
    provideHttpClient(withInterceptorsFromDi(), withInterceptors([authInterceptor])),
    { provide: HTTP_INTERCEPTORS, useClass: HttpErrorInterceptor, multi: true },
    {
      provide: APP_INITIALIZER,
      useFactory: initializeTheme,
      deps: [ThemeService],
      multi: true
    },
    {
      provide: APP_INITIALIZER,
      useFactory: initializePasskeyStore,
      deps: [PasskeyStoreService],
      multi: true
    },
    importProvidersFrom(
      TranslateModule.forRoot({
        loader: {
          provide: TranslateLoader,
          useFactory: httpTranslateLoader,
          deps: [HttpClient],
        },
      })
    ),
    importProvidersFrom(IonicStorageModule.forRoot()),
    ...KEY_STORAGE_PROVIDERS,
    AUTH_SERVICE_PROVIDER,
    provideRouter(routes),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
});
