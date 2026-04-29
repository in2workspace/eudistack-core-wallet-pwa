import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';

export type WizardState = 'not-bootstrapped' | 'already-bootstrapped' | 'standalone-divergence';

@Component({
  selector: 'app-ios-install-onboarding',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './ios-install-onboarding.page.html',
  styleUrl: './ios-install-onboarding.page.scss',
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class IosInstallOnboardingPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly alertController = inject(AlertController);
  private readonly iosInstall = inject(IosInstallService);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly telemetry = inject(TelemetryService);
  private readonly translate = inject(TranslateService);

  state: WizardState = 'not-bootstrapped';

  readonly steps = [
    { icon: 'share-outline',        labelKey: 'ios-install.step1', detailKey: 'ios-install.step1-detail' },
    { icon: 'ellipsis-horizontal',  labelKey: 'ios-install.step2', detailKey: 'ios-install.step2-detail' },
    { icon: 'add-circle-outline',   labelKey: 'ios-install.step3', detailKey: 'ios-install.step3-detail' },
    { icon: 'phone-portrait-outline', labelKey: 'ios-install.step4', detailKey: 'ios-install.step4-detail' },
  ];

  ngOnInit(): void {
    const queryState = this.route.snapshot.queryParamMap.get('state') as WizardState | null;
    this.state = queryState ?? this.iosInstall.wizardState(this.passkeyStore.hasPasskey());
    this.telemetry.track('ios_onboarding_shown', { state: this.state });
  }

  async openLearnMore(): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('ios-install.learn-more'),
      message: this.translate.instant('ios-install.learn-more-body'),
      buttons: [{ text: this.translate.instant('ios-install.learn-more-close'), role: 'cancel' }],
      cssClass: 'ios-learn-more-alert',
    });
    await alert.present();
  }

  async continueAnyway(): Promise<void> {
    const confirmAlert = await this.alertController.create({
      header: this.translate.instant('ios-install.confirm-title'),
      message: this.translate.instant('ios-install.confirm-message'),
      buttons: [
        { text: this.translate.instant('ios-install.confirm-cancel'), role: 'cancel' },
        {
          text: this.translate.instant('ios-install.confirm-ok'),
          role: 'confirm',
          handler: () => this.handleDismiss(),
        },
      ],
    });
    await confirmAlert.present();
  }

  private handleDismiss(): void {
    this.iosInstall.dismissOnboarding();
    this.telemetry.track('ios_onboarding_dismissed', { state: this.state });
    const hasPasskey = this.passkeyStore.hasPasskey();
    this.router.navigateByUrl(hasPasskey ? '/auth/login' : '/auth/register');
  }
}
