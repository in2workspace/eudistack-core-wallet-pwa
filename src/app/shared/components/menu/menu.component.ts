import { Component } from '@angular/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { RouterModule } from '@angular/router';
import { IonicModule, PopoverController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';

@Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'app-menu',
    templateUrl: './menu.component.html',
    imports: [IonicModule, CommonModule, RouterModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class MenuComponent {
  public constructor(
    private readonly popOverController: PopoverController,
    private readonly authService: AuthService,
  ) {}
  public logoutOnKeydown(event: KeyboardEvent): void{
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
