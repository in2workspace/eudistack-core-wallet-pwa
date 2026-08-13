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
import { WALLET_DISCOVERY_GATEWAY } from './app/core/gateways/wallet-discovery.gateway';
import { HttpWalletDiscoveryGateway } from './app/core/gateways/http-wallet-discovery.gateway';
import { walletDiscoveryInitializer } from './app/core/initializers/wallet-discovery.initializer';
import { WalletDiscoveryService } from './app/core/services/wallet-discovery.service';
import { TenantService } from './app/core/services/tenant.service';
import { tenantInitializer } from './app/core/initializers/tenant.initializer';
import { TRANSLATION_ENGINE } from './app/core/ports/translation-engine.port';
import { BrowserTranslatorEngineAdapter } from './app/core/adapters/browser-translator-engine.adapter';
import { UiTextTranslationService } from './app/core/services/ui-text-translation.service';

function initializeTheme(themeService: ThemeService): () => Promise<void> {
  return () => themeService.load();
}

function initializePasskeyStore(store: PasskeyStoreService): () => Promise<void> {
  return () => store.init();
}

/**
 * Restores the persisted runtime-translation preference on every app start
 * (AC-06: "cierra la aplicación y la vuelve a abrir... sin volver a pedir la
 * activación") — not just when the Holder happens to revisit the language
 * selector page.
 *
 * Deliberately fire-and-forget: bootstrap must not block on this (up to
 * TRANSLATION_BUDGET_MS = 20s on a cache miss) — AC-11 requires the app stay
 * usable during preparation. The UI swaps to the target language reactively
 * once ready, via @ngx-translate's existing onTranslationChange subscription
 * — regardless of which page is on screen when it resolves. Must run after
 * initializeTheme so the native language is already active when
 * restoreFromPreference()'s internal activate() call reads it.
 */
function restoreUiTranslation(service: UiTextTranslationService): () => Promise<void> {
  return () => {
    void service.restoreFromPreference();
    return Promise.resolve();
  };
}

disableTouchScrollOnPaths(
  ['/tabs/home']
);

if (environment.production) {
  enableProdMode();
}

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    importProvidersFrom(
      IonicModule.forRoot({ innerHTMLTemplatesEnabled: true, useSetInputAPI: true })
    ),
    provideHttpClient(withInterceptorsFromDi(), withInterceptors([authInterceptor])),
    { provide: HTTP_INTERCEPTORS, useClass: HttpErrorInterceptor, multi: true },
    // Wallet discovery gateway (infrastructure adapter for Task 5).
    { provide: WALLET_DISCOVERY_GATEWAY, useClass: HttpWalletDiscoveryGateway },
    // On-device translation engine port (EUD-142, AD-1: on-device strict).
    { provide: TRANSLATION_ENGINE, useClass: BrowserTranslatorEngineAdapter },
    // IMPORTANT — ordering: walletDiscoveryInitializer MUST be first so that
    // WalletDiscoveryService.mode() is resolved before initializeTheme and
    // initializePasskeyStore run (AD-1, AC-009.1a).
    {
      provide: APP_INITIALIZER,
      useFactory: walletDiscoveryInitializer,
      deps: [WalletDiscoveryService],
      multi: true,
    },
    {
      provide: APP_INITIALIZER,
      useFactory: tenantInitializer,
      deps: [TenantService],
      multi: true,
    },
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
    // Must run after initializeTheme (native language already active).
    {
      provide: APP_INITIALIZER,
      useFactory: restoreUiTranslation,
      deps: [UiTextTranslationService],
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
      registrationStrategy: 'registerImmediately',
    }),
  ],
});
