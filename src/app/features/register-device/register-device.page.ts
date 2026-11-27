import { Component, DestroyRef, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors } from '@angular/forms';
import { take } from 'rxjs/operators';
import { Router } from '@angular/router';
import { IonicModule } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ACCESS_ROUTE, RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletInstanceService } from 'src/app/core/services/wallet-instance.service';
import { WALLET_HOME_ROUTE } from 'src/app/core/guards/auth.guard';
import { takePendingDeepLink } from 'src/app/shared/helpers/pending-deep-link';
import {
  DEVICE_NAME_MAX_LENGTH,
  DeviceProposal,
  deviceName,
  isValidDeviceName,
  proposeDevice,
} from 'src/app/core/utils/device-proposal';
import { deviceTypeIcon } from 'src/app/features/devices/device-type-icon';

/**
 * "Registrar este dispositivo" (EUD-15 wireframes, FR-01, FR-03, FR-04, FR-06): its own step after the passkey,
 * never inside it, without a step indicator. The name is proposed from the equipment and the browser (or the
 * installed app) and the user can change it; Continue registers the device, binds the session to it and goes on
 * with the saved offer or to the wallet. Leaving it keeps the session without a device: the screen comes back on
 * the next entry, and the saved offer waits until then.
 */
@Component({
  selector: 'app-register-device',
  templateUrl: './register-device.page.html',
  styleUrls: ['../auth/login/login.page.scss', './register-device.page.scss'],
  imports: [IonicModule, ReactiveFormsModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class RegisterDevicePage implements OnInit {
  @ViewChild('heading') private readonly heading?: ElementRef<HTMLElement>;

  public readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [validDeviceName] }),
  });
  public readonly busy = signal(false);
  public readonly failed = signal(false);
  public readonly maxLength = DEVICE_NAME_MAX_LENGTH;
  public readonly icon = computed(() => deviceTypeIcon(this.proposal.type));
  public readonly length = computed(() => [...this.name()].length);
  public readonly canContinue = computed(() => isValidDeviceName(this.name()) && !this.busy());

  private readonly name = toSignal(this.form.controls.name.valueChanges, { initialValue: '' });
  private readonly destroyRef = inject(DestroyRef);

  private readonly auth = inject(RemoteAuthService);
  private readonly walletInstance = inject(WalletInstanceService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  private readonly proposal: DeviceProposal = proposeDevice();

  public ngOnInit(): void {
    // `get` waits for the translations: `instant` could still return the key on a cold start.
    this.translate.get('device-registration.installed-app').pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(installedApp => {
        const name = this.form.controls.name;
        if (name.pristine) {
          name.setValue(deviceName(this.proposal, installedApp));
        }
      });
    setTimeout(() => this.heading?.nativeElement.focus());
  }

  public async register(): Promise<void> {
    if (!this.canContinue()) return;
    const account = this.auth.accountId();
    if (!account) {
      await this.router.navigateByUrl(ACCESS_ROUTE, { replaceUrl: true });
      return;
    }
    this.busy.set(true);
    this.failed.set(false);
    try {
      await this.walletInstance.register(account, this.form.controls.name.value, this.proposal.type);
      await this.auth.deviceRegistered();
      await this.router.navigateByUrl(takePendingDeepLink() || WALLET_HOME_ROUTE, { replaceUrl: true });
    } catch (err) {
      console.error('[RegisterDevicePage] Could not register the device', err);
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}

/** Not empty and at most 50 characters once trimmed (EUD-15 FR-04). */
function validDeviceName(control: AbstractControl<string>): ValidationErrors | null {
  return isValidDeviceName(control.value ?? '') ? null : { deviceName: true };
}
