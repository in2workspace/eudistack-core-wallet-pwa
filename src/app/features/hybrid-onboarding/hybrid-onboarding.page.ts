import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { HybridAuditService } from 'src/app/core/services/hybrid-audit.service';
import { HybridOnboardingService } from 'src/app/core/services/hybrid-onboarding.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';

@Component({
  selector: 'app-hybrid-onboarding',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './hybrid-onboarding.page.html',
  styleUrl: './hybrid-onboarding.page.scss',
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class HybridOnboardingPage implements OnInit {
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly hybridOnboarding = inject(HybridOnboardingService);
  private readonly hybridAudit = inject(HybridAuditService);
  private readonly telemetry = inject(TelemetryService);
  private readonly translate = inject(TranslateService);

  readonly bullets = [
    'hybrid-onboarding.bullet-1',
    'hybrid-onboarding.bullet-2',
    'hybrid-onboarding.bullet-3',
  ];

  ngOnInit(): void {
    this.telemetry.track('hybrid_onboarding_shown');
  }

  accept(): void {
    this.hybridOnboarding.markAccepted();
    this.hybridAudit
      .recordConstraintAccepted()
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.telemetry.track('hybrid_onboarding_accepted');
        this.router.navigateByUrl('/tabs');
      });
  }

  async openLearnMore(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('hybrid-onboarding.learn-more'),
      message: this.translate.instant('hybrid-onboarding.learn-more-body'),
      buttons: [{ text: this.translate.instant('hybrid-onboarding.learn-more-close'), role: 'cancel' }],
    });
    await alert.present();
  }
}
