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
  }

  public ngOnDestroy(){
    this.destroy$.next();
    this.destroy$.complete();
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