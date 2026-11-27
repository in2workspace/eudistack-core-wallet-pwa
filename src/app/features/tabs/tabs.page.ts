import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { RouterModule } from '@angular/router';
import { AuthService } from 'src/app/core/services/auth.service';

@Component({
    selector: 'app-tabs',
    templateUrl: './tabs.page.html',
    styleUrls: ['./tabs.page.scss'],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        TranslateModule,
        RouterModule,
    ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class TabsPage {
  private readonly auth = inject(AuthService, { optional: true });

  /**
   * EUD-15 design §2.2: while the session cannot be bound to its device (temporary failure, retried in the
   * background), the wallet stays visible but scanning an offer or a presentation request is disabled.
   */
  public scanDisabled(): boolean {
    return this.auth?.deviceUnavailable() ?? false;
  }
}
