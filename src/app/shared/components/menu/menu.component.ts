import { Component, inject } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { RouterModule } from '@angular/router';
import { IonicModule, PopoverController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ThemeService } from 'src/app/core/services/theme.service';
import { PwaInstallService } from 'src/app/shared/services/pwa-install.service';
import { environment } from 'src/environments/environment';

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
  private readonly themeService = inject(ThemeService);
  private readonly pwaInstallService = inject(PwaInstallService);

  readonly walletName = this.themeService.snapshot?.branding?.name || 'EUDI';
  readonly appVersion = environment.appVersion;
  readonly isServerMode = environment.key_storage_mode === 'server';
  readonly canInstall$ = this.pwaInstallService.installable$;

  public logoutOnKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.logout();
    }
  }

  public logout(): void {
    this.authService.logout().subscribe(() => {
      window.location.href = '/auth/login';
    });
    this.popOverController.dismiss();
  }

  public async installApp(): Promise<void> {
    await this.pwaInstallService.promptInstall();
    this.popOverController.dismiss();
  }

  public dismiss(): void {
    this.popOverController.dismiss();
  }
}
