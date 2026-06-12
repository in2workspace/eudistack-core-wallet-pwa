import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { TenantService } from 'src/app/core/services/tenant.service';

@Component({
  selector: 'app-tenant-not-found',
  templateUrl: './tenant-not-found.page.html',
  styleUrls: ['./tenant-not-found.page.scss'],
  imports: [CommonModule, IonicModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class TenantNotFoundPage {
  private readonly tenantService = inject(TenantService);
  public readonly fallbackUrl = this.tenantService.buildFallbackUrl();
  public readonly hostname = window.location.hostname;

  public goToFallback(): void {
    window.location.href = this.fallbackUrl;
  }
}
