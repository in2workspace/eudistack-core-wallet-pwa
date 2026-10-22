import { Component, computed, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NavigationStart, Router, RouterModule } from '@angular/router';
import { filter } from 'rxjs';
import { ACCESS_ROUTE, AuthService } from 'src/app/core/services/auth.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { AlertController, IonicModule, PopoverController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'app-menu',
    templateUrl: './menu.component.html',
    styleUrls: ['./menu.component.scss'],
    imports: [IonicModule, CommonModule, RouterModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class MenuComponent {
  private readonly popOverController = inject(PopoverController);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);

  private readonly discoverySnapshot = inject(WalletDiscoveryService).snapshot();

  readonly userName = toSignal(this.authService.getName$(), { initialValue: '' });

  readonly showConnectedDevices = computed(() => {
    const snapshot = this.discoverySnapshot();
    return !(snapshot?.mode === 'browser' && snapshot.source === 'discovery');
  });

  public constructor() {
    // The entries navigate through routerLink, which does not close the popover:
    // dismiss it (and its backdrop) as soon as any navigation starts. It may already
    // be closed (e.g. logout dismisses it first), so a rejected dismiss is ignored.
    this.router.events
      .pipe(filter(event => event instanceof NavigationStart), takeUntilDestroyed())
      .subscribe(() => this.popOverController.dismiss().catch(() => undefined));
  }

  public logoutOnKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.logout();
    }
  }

  /**
   * Server mode asks first (EUD-8, wireframe "Cerrar sesión"): ending the session
   * in the service means signing in again with the passkey. Browser mode closes
   * straight away, as before.
   */
  public logout(): void {
    void this.popOverController.dismiss().catch(() => undefined);
    if (this.discoverySnapshot()?.mode !== 'server') {
      this.endSession();
      return;
    }
    void this.confirmLogout();
  }

  private async confirmLogout(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('wallet-access.logout.title'),
      buttons: [
        { text: this.translate.instant('wallet-access.logout.cancel'), role: 'cancel' },
        { text: this.translate.instant('wallet-access.logout.confirm'), role: 'confirm', handler: () => this.endSession() },
      ],
    });
    await alert.present();
  }

  private endSession(): void {
    this.authService.logout().subscribe(() => {
      void this.router.navigateByUrl(this.discoverySnapshot()?.mode === 'server' ? ACCESS_ROUTE : '/auth/login');
    });
  }
}
