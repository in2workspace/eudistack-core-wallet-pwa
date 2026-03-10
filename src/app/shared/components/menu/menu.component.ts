import { Component, inject } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { RouterModule } from '@angular/router';
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
}
