import { Component, DestroyRef, Injector, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { timeout } from 'rxjs/operators';
import { DatePipe } from '@angular/common';
import { ActionSheetController, AlertController, IonicModule } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletInstance, WalletInstanceService } from 'src/app/core/services/wallet-instance.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { DEVICE_NAME_MAX_LENGTH, isValidDeviceName } from 'src/app/core/utils/device-proposal';
import { deviceTypeIcon } from './device-type-icon';

export const DEVICE_LIST_TIMEOUT_MS = 10_000;

/**
 * "Dispositivos" (EUD-15 wireframes, FR-09 to FR-17): the active devices of the account, the current one first
 * and marked with text, then by last use. Each one can be renamed and revoked; revoking the current one ends the
 * session here, forgets the device and goes to the access screen. Revoking never removes passkeys nor
 * attestations. Server mode only.
 */
@Component({
  selector: 'app-devices',
  templateUrl: './devices.page.html',
  styleUrls: ['./devices.page.scss'],
  imports: [IonicModule, DatePipe, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class DevicesPage implements OnInit {
  public readonly devices = signal<WalletInstance[]>([]);
  public readonly loading = signal(true);
  public readonly error = signal(false);
  public readonly unavailable = signal(false);

  /** The current device first, then by last use, the most recent first (the service already sorts them). */
  public readonly sortedDevices = computed(() => {
    const list = [...this.devices()];
    return list.sort((a, b) => Number(b.current) - Number(a.current)
      || lastUse(b).localeCompare(lastUse(a)));
  });

  private readonly walletInstances = inject(WalletInstanceService);
  // RemoteAuthService only in server mode: creating it in browser mode would start a server session handling.
  private readonly injector = inject(Injector);
  /** A rename or a revocation in flight: a second tap is ignored. */
  private busy = false;
  private readonly alertController = inject(AlertController);
  private readonly actionSheetController = inject(ActionSheetController);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly destroyRef = inject(DestroyRef);

  public ngOnInit(): void {
    if (this.discovery.mode() !== 'server') {
      this.loading.set(false);
      this.unavailable.set(true);
      return;
    }
    this.load();
  }

  public backToWallet(): void {
    void this.router.navigate(['/tabs/credentials']);
  }

  public icon(device: WalletInstance): string {
    return deviceTypeIcon(device.deviceType);
  }

  public load(): void {
    this.loading.set(true);
    this.error.set(false);
    this.walletInstances.list().pipe(
      timeout(DEVICE_LIST_TIMEOUT_MS),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: devices => {
        this.devices.set(devices);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      },
    });
  }

  /** The [...] menu of a device: Renombrar and Revocar. */
  public async openMenu(device: WalletInstance): Promise<void> {
    const sheet = await this.actionSheetController.create({
      header: device.displayName,
      buttons: [
        { text: this.translate.instant('devices.rename'), icon: 'pencil-outline', handler: () => { void this.rename(device); } },
        {
          text: this.translate.instant('devices.revoke'),
          icon: 'trash-outline',
          role: 'destructive',
          handler: () => { void this.revoke(device); },
        },
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  /** "Renombrar dispositivo": not empty, 50 characters at most; on failure the dialog stays open (FR-12). */
  public async rename(device: WalletInstance): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('devices.rename-header'),
      inputs: [{
        name: 'displayName',
        type: 'text',
        value: device.displayName,
        attributes: { maxlength: DEVICE_NAME_MAX_LENGTH, 'aria-label': this.translate.instant('devices.rename-label') },
      }],
      buttons: [
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('devices.save'),
          handler: async (data: { displayName?: string }) => {
            if (this.busy) return false;
            const name = data?.displayName ?? '';
            if (!isValidDeviceName(name)) {
              alert.message = this.translate.instant('devices.rename-invalid', { max: DEVICE_NAME_MAX_LENGTH });
              return false;
            }
            this.busy = true;
            try {
              const renamed = await firstValueFrom(this.walletInstances.rename(device.id, name));
              this.devices.update(list => list.map(d => d.id === renamed.id ? { ...renamed, current: d.current } : d));
              return true;
            } catch {
              alert.message = this.translate.instant('devices.rename-failed');
              return false;
            } finally {
              this.busy = false;
            }
          },
        },
      ],
    });
    await alert.present();
  }

  /**
   * "Revocar" (FR-13 to FR-15): explicit confirmation that says the attestations and passkeys do not change. The
   * current device says the session ends now; after the revocation it is forgotten and the access screen shown.
   */
  public async revoke(device: WalletInstance): Promise<void> {
    const current = device.current;
    const alert = await this.alertController.create({
      header: current
        ? this.translate.instant('devices.revoke-current-header')
        : this.translate.instant('devices.revoke-header', { name: device.displayName }),
      message: this.translate.instant(current ? 'devices.revoke-current-message' : 'devices.revoke-message'),
      buttons: [
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
        {
          text: this.translate.instant(current ? 'devices.revoke-current-confirm' : 'devices.revoke-confirm'),
          role: 'destructive',
          handler: async () => {
            if (this.busy) return false;
            this.busy = true;
            try {
              await firstValueFrom(this.walletInstances.revoke(device.id), { defaultValue: undefined });
            } catch {
              alert.message = this.translate.instant('devices.revoke-failed');
              return false;
            } finally {
              this.busy = false;
            }
            if (current) {
              await this.leaveRevokedDevice();
            } else {
              this.devices.update(list => list.filter(d => d.id !== device.id));
            }
            return true;
          },
        },
      ],
    });
    await alert.present();
  }

  /** The service already ended this session: forget the device here and go to the access screen. */
  private async leaveRevokedDevice(): Promise<void> {
    const auth = this.injector.get(RemoteAuthService);
    const account = auth.accountId();
    if (account) {
      await this.walletInstances.forget(account);
    }
    auth.forceLogout();
  }
}

function lastUse(device: WalletInstance): string {
  return device.lastUsedAt ?? device.createdAt;
}
