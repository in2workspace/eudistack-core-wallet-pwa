import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { OssLicenseService } from '../services/oss-license.service';
import { SupportChannelService } from '../services/support-channel.service';
import { OssLicense } from '../models/oss-license.model';

/**
 * AC-05 / EC-06 / ES-03.
 * The OssLicenseService already degrades any load failure to an empty list
 * (never throws), so an empty result here always means "show the explanatory
 * empty state" — the service does not distinguish "empty release" from
 * "manifest missing/corrupt" because in practice a real release always ships
 * production dependencies.
 */
@Component({
  selector: 'app-oss-licenses',
  templateUrl: './oss-licenses.page.html',
  styleUrls: ['./oss-licenses.page.scss'],
  imports: [IonicModule, CommonModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class OssLicensesPage implements OnInit {
  private readonly ossLicenseService = inject(OssLicenseService);
  private readonly support = inject(SupportChannelService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly licenses = signal<readonly OssLicense[]>([]);

  readonly supportMailto = this.support.buildSupportMailto();

  ngOnInit(): void {
    this.ossLicenseService
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((licenses) => {
        this.licenses.set(licenses);
        this.loading.set(false);
      });
  }
}
