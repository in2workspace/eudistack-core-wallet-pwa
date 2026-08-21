import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AuthService } from 'src/app/core/services/auth.service';
import { PasskeyApiService, PasskeyInfo } from 'src/app/core/services/passkey-api.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';

@Component({
    selector: 'app-devices',
    templateUrl: './devices.page.html',
    styleUrls: ['./devices.page.scss'],
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class DevicesPage implements OnInit {
  private readonly passkeyApi = inject(PasskeyApiService);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly authService = inject(AuthService);
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly discovery = inject(WalletDiscoveryService);
  private readonly destroyRef = inject(DestroyRef);

  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  /** True when the wallet operates in server (EBW) mode (AC-009.2c, AC-009.3c). */
  get isServerMode(): boolean {
    return this.discovery.mode() === 'server';
  }
  readonly currentCredentialId = this.passkeyStore.getCredentialId();

  readonly currentDevice = computed<PasskeyInfo | null>(() => {
    const credentialId = this.currentCredentialId;
    if (!credentialId) return null;
    return this.passkeys().find((p) => p.credentialId === credentialId) ?? null;
  });

  readonly otherDevices = computed<PasskeyInfo[]>(() => {
    const current = this.currentDevice();
    return this.passkeys().filter((p) => p.id !== current?.id);
  });

  ngOnInit(): void {
    if (!this.isServerMode) {
      // Redirect to settings if not in server mode
      this.router.navigate(['/tabs/settings']);
      return;
    }
    this.loadPasskeys();
  }

  backToWallet(): void {
    void this.router.navigate(['/tabs/credentials']);
  }

  deviceIcon(passkey: PasskeyInfo): string {
    const name = passkey.displayName?.toLowerCase() ?? '';

    if (/ipad|tablet|galaxy tab|surface/.test(name)) {
      return 'tablet-portrait-outline';
    }
    if (/iphone|android|phone|pixel|galaxy|mobile|xiaomi|huawei/.test(name)) {
      return 'phone-portrait-outline';
    }
    return 'desktop-outline';
  }

  loadPasskeys(): void {
    this.loading.set(true);
    this.error.set(false);

    this.passkeyApi.listPasskeys().subscribe({
      next: (passkeys) => {
        this.passkeys.set(passkeys);
        this.loading.set(false);
      },
      error: () => {
        this.error.set(true);
        this.loading.set(false);
      }
    });
  }

  async renamePasskey(passkey: PasskeyInfo): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('devices.rename-header'),
      inputs: [
        {
          name: 'displayName',
          type: 'text',
          placeholder: this.translate.instant('devices.rename-placeholder'),
          value: passkey.displayName,
        },
      ],
      buttons: [
        {
          text: this.translate.instant('devices.cancel'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('devices.rename-confirm'),
          handler: (data) => {
            if (data.displayName?.trim()) {
              this.passkeyApi.renamePasskey(passkey.id, data.displayName.trim()).subscribe({
                next: (updated) => {
                  this.passkeys.update(list =>
                    list.map(p => p.id === updated.id ? updated : p)
                  );
                },
                error: (err) => console.error('Failed to rename passkey:', err)
              });
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async deletePasskey(passkey: PasskeyInfo): Promise<void> {
    const selfRevoke = this.isSelfRevoke(passkey);
    const alert = await this.alertController.create({
      header: this.translate.instant('devices.delete-header'),
      message: this.translate.instant(selfRevoke ? 'devices.delete-self-message' : 'devices.delete-message'),
      buttons: [
        {
          text: this.translate.instant('devices.cancel'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('devices.delete-confirm'),
          role: 'destructive',
          handler: () => {
            this.passkeyApi.deletePasskey(passkey.id).pipe(
              takeUntilDestroyed(this.destroyRef)
            ).subscribe({
              next: async () => {
                this.passkeys.update(list => list.filter(p => p.id !== passkey.id));
                // Self-revoke detection lives only here (success), never in `error` (R-3):
                // a failed/timed-out revocation must not force a logout that didn't happen.
                if (selfRevoke) {
                  await this.passkeyStore.clearCredentialId();
                  this.authService.forceLogout();
                }
              },
              error: async (err) => {
                if (err.status === 409) {
                  // Last passkey error
                  const errorAlert = await this.alertController.create({
                    header: this.translate.instant('devices.error-header'),
                    message: this.translate.instant('devices.last-passkey-error'),
                    buttons: [this.translate.instant('devices.ok')],
                  });
                  await errorAlert.present();
                }
              }
            });
          },
        },
      ],
    });
    await alert.present();
  }

  async revokeSessions(passkey: PasskeyInfo): Promise<void> {
    this.passkeyApi.revokeSessions(passkey.id).subscribe({
      next: () => {
        this.passkeys.update(list =>
          list.map(p => p.id === passkey.id ? { ...p, activeSessions: 0 } : p)
        );
      },
      error: (err) => console.error('Failed to revoke sessions:', err)
    });
  }

  /**
   * A passkey is the current device's only when its credentialId matches the locally
   * stored one. If the local credentialId can't be resolved (EC-03), fail safe to `false`
   * rather than risk forcing a logout that doesn't correspond to the revoked device.
   */
  private isSelfRevoke(passkey: PasskeyInfo): boolean {
    return !!this.currentCredentialId && passkey.credentialId === this.currentCredentialId;
  }
}

