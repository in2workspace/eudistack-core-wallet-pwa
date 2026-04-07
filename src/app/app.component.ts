import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, Signal, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonicModule, PopoverController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MenuComponent } from './shared/components/menu/menu.component';
import { Subject, map } from 'rxjs';
import { CameraService } from './shared/services/camera.service';
import { LoaderService } from './shared/services/loader.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { Oid4vciEngineService } from './core/protocol/oid4vci/oid4vci.engine.service';
import { ThemeService } from './core/services/theme.service';
import { IssuerMetadataCacheService } from './core/services/issuer-metadata-cache.service';
import { UserPreferencesService } from './shared/services/user-preferences.service';
import { App, URLOpenListenerEvent } from '@capacitor/app';
import { AuthService } from './core/services/auth.service';
import { STEPUP_ACTION_KEY } from './core/constants/deep-link.constants';

@Component({
    selector: 'app-root',
    templateUrl: 'app.component.html',
    styleUrls: ['app.component.scss'],
    imports: [
        IonicModule,
        CommonModule,
        TranslateModule,
    ]
})

export class AppComponent implements OnInit, OnDestroy {
  private readonly loader = inject(LoaderService);
  private readonly oid4vciEngine = inject(Oid4vciEngineService);
  private readonly router = inject(Router);
  private readonly issuerMetadataCache = inject(IssuerMetadataCacheService);
  private readonly themeService = inject(ThemeService);
  private readonly _prefs = inject(UserPreferencesService); // eagerly init dark mode
  private readonly authService = inject(AuthService);

  public routerEvents$ = this.router.events;
  // if the route is "/", don't allow menu popover
  public isBaseRoute$ = toSignal<boolean>(this.routerEvents$.pipe(map(ev => this.router.url === '/')));
  // if the route is an auth route, blurs the toolbar to give a "transitional effect"
  public isAuthRoute$ = toSignal<boolean>(this.routerEvents$.pipe(map(ev => {
      const currentUrl = this.router.url.split('?')[0];
      return currentUrl.startsWith('/auth') || currentUrl.startsWith('/protocol');
  })));
  public logoSrc: string | null = null;
  private readonly destroy$ = new Subject<void>();
  public isLoading$: Signal<boolean>;

  private readonly cameraService = inject(CameraService);
  private readonly popoverController = inject(PopoverController);
  public readonly translate = inject(TranslateService);

  public constructor() {
    this.isLoading$ = this.loader.isLoading$;
  }

  public ngOnInit() {
    this.logoSrc = this.themeService.getLogoUrl('light');
    this.initOid4vciEngine();
    this.issuerMetadataCache.refreshStaleMetadata().catch(console.warn);
    this.alertIncompatibleDevice();
    this.consumeLaunchQueue();
    this.registerNativeDeepLinkListener();
  }

  /**
   * Handles URLs delivered by the Launch Handler API when the PWA is already
   * open and the browser reuses the existing window instead of opening a new one.
   * Requires `launch_handler.client_mode: "navigate-existing"` in the manifest.
   */
  private consumeLaunchQueue(): void {
    if ('launchQueue' in window) {
      (window as any).launchQueue.setConsumer((launchParams: any) => {
        if (launchParams.targetURL) {
          const url = new URL(launchParams.targetURL);
          this.router.navigateByUrl(url.pathname + url.search);
        }
      });
    }
  }

  private registerNativeDeepLinkListener(): void {
    App.addListener('appUrlOpen', (event: URLOpenListenerEvent) => {
      const incomingUrl = event.url;
      if (!incomingUrl) { return; }

      if (this.authService.isLoggedIn()) {
        // Session is active → store URL and force step-up re-authentication
        localStorage.setItem(STEPUP_ACTION_KEY, incomingUrl);
        this.router.navigate(['/auth/login']);
      } else {
        // No session → treat as a normal cold-start deep link via sessionStorage
        try {
          const parsed = new URL(incomingUrl);
          this.router.navigateByUrl(parsed.pathname + parsed.search);
        } catch {
          // Malformed URL — ignore silently
        }
      }
    }).catch(console.error);
  }

  public ngOnDestroy(){
    this.destroy$.next();
    this.destroy$.complete();
    App.removeAllListeners().catch(console.error);
  }

  private initOid4vciEngine(): void {
    this.oid4vciEngine.init().catch(console.error);
  }

  //alert for IOs below 14.3
  private alertIncompatibleDevice(): void{
    const problematicIosVersion = this.cameraService.isIOSVersionLowerThan(14.3);
    const isNotSafari = this.cameraService.isNotSafari();
    if (problematicIosVersion && isNotSafari) {
      alert('This application scanner is probably not supported on this device with this browser. If you have issues, use Safari browser.');
    }
  }


  public openPopoverByKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
        this.openPopover(event);
        event.preventDefault();
    }
  }

  public async openPopover(ev: Event): Promise<void> {
    if (this.isAuthRoute$()) {
      return; 
    }
    const popover = await this.popoverController.create({
      component: MenuComponent,
      event: ev,
      translucent: true,
      cssClass: 'custom-popover',
    });

    await popover.present();
  }


}