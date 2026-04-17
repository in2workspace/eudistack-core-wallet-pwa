import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { buildFallbackUrl } from 'src/app/core/constants/tenants.constants';

@Component({
  selector: 'app-tenant-not-found',
  templateUrl: './tenant-not-found.page.html',
  styleUrls: ['./tenant-not-found.page.scss'],
  imports: [CommonModule, IonicModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class TenantNotFoundPage {
  public readonly fallbackUrl = buildFallbackUrl();
  public readonly hostname = window.location.hostname;

  public goToFallback(): void {
    window.location.href = this.fallbackUrl;
  }
}
