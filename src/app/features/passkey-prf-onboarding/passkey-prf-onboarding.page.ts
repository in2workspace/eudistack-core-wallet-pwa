import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { PasskeyPrfAuditService } from 'src/app/core/services/passkey-prf-audit.service';
import { PasskeyPrfOnboardingService } from 'src/app/core/services/passkey-prf-onboarding.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';

@Component({
  selector: 'app-passkey-prf-onboarding',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './passkey-prf-onboarding.page.html',
  styleUrl: './passkey-prf-onboarding.page.scss',
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class PasskeyPrfOnboardingPage implements OnInit {
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly passkeyPrfOnboarding = inject(PasskeyPrfOnboardingService);
  private readonly passkeyPrfAudit = inject(PasskeyPrfAuditService);
  private readonly telemetry = inject(TelemetryService);
  private readonly translate = inject(TranslateService);

  readonly bullets = [
    'passkey-prf-onboarding.bullet-1',
    'passkey-prf-onboarding.bullet-2',
    'passkey-prf-onboarding.bullet-3',
  ];

  ngOnInit(): void {
    this.telemetry.track('passkey_prf_onboarding_shown');
  }

  accept(): void {
    this.passkeyPrfOnboarding.markAccepted();
    this.telemetry.track('passkey_prf_onboarding_accepted');
    void this.router.navigateByUrl(takePendingDeepLink() ?? '/tabs');
    this.passkeyPrfAudit.recordConstraintAccepted().pipe(catchError(() => of(null))).subscribe();
  }

  async openLearnMore(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('passkey-prf-onboarding.learn-more'),
      message: this.translate.instant('passkey-prf-onboarding.learn-more-body'),
      buttons: [{ text: this.translate.instant('passkey-prf-onboarding.learn-more-close'), role: 'cancel' }],
    });
    await alert.present();
  }
}
