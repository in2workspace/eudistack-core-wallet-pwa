import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PasskeyInfo, PasskeyService } from 'src/app/core/services/passkey.service';
import { AuthService } from 'src/app/core/services/auth.service';

@Component({
    selector: 'app-devices',
    templateUrl: './devices.page.html',
    styleUrls: ['./devices.page.scss'],
    imports: [
        IonicModule,
        CommonModule,
        FormsModule,
        TranslateModule,
    ]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class DevicesPage implements OnInit {
  passkeys: PasskeyInfo[] = [];
  loading = true;
  error = false;

  private readonly passkeyService = inject(PasskeyService);
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly authService = inject(AuthService);

  ngOnInit(): void {
    this.loadPasskeys();
  }

  loadPasskeys(): void {
    this.loading = true;
    this.error = false;
    this.passkeyService.listPasskeys().subscribe({
      next: (passkeys) => {
        this.passkeys = passkeys;
        this.loading = false;
      },
      error: () => {
        this.error = true;
        this.loading = false;
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
          value: passkey.displayName,
          placeholder: this.translate.instant('devices.rename-placeholder'),
        },
      ],
      buttons: [
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('devices.rename-confirm'),
          handler: (data: { displayName?: string }) => {
            const name = data.displayName?.trim();
            if (name && name !== passkey.displayName) {
              this.passkeyService.renamePasskey(passkey.id, name).subscribe({
                next: (updated) => {
                  const idx = this.passkeys.findIndex(p => p.id === passkey.id);
                  if (idx >= 0) {
                    this.passkeys[idx] = updated;
                  }
                },
              });
            }
          },
        },
      ],
    });
    await alert.present();
  }

  async deletePasskey(passkey: PasskeyInfo): Promise<void> {
    const alert = await this.alertController.create({
      header: this.translate.instant('devices.delete-header'),
      message: this.translate.instant('devices.delete-message'),
      buttons: [
        { text: this.translate.instant('devices.cancel'), role: 'cancel' },
        {
          text: this.translate.instant('devices.delete-confirm'),
          cssClass: 'danger',
          handler: () => {
            this.passkeyService.deletePasskey(passkey.id).subscribe({
              next: () => {
                this.passkeys = this.passkeys.filter(p => p.id !== passkey.id);
                if (this.passkeys.length === 0) {
                  localStorage.removeItem('wallet_has_passkey');
                  this.authService.forceLogout();
                }
              },
            });
          },
        },
      ],
    });
    await alert.present();
  }

}
