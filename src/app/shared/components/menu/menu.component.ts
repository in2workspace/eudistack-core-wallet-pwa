import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from 'src/app/core/services/auth.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { IonicModule, PopoverController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

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

  private readonly discoverySnapshot = inject(WalletDiscoveryService).snapshot();

  readonly userName = toSignal(this.authService.getName$(), { initialValue: '' });

  readonly showConnectedDevices = computed(() => {
    const snapshot = this.discoverySnapshot();
    return !(snapshot?.mode === 'browser' && snapshot.source === 'discovery');
  });

  public logoutOnKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.logout();
    }
  }

  public logout(): void {
    this.authService.logout().subscribe(() => {
      this.router.navigate(['/auth/login']);
    });
    this.popOverController.dismiss();
  }
}
