import { enableProdMode, importProvidersFrom } from '@angular/core';
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
import { HttpErrorInterceptor } from './app/interceptors/error-handler.interceptor';
import { authInterceptor } from './app/interceptors/auth.interceptor';
import { disableTouchScrollOnPaths } from './app/helpers/disable-touch-scroll-on-paths';
import { httpTranslateLoader } from './app/helpers/http-translate-loader';


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
    provideRouter(routes)
  ],
});
