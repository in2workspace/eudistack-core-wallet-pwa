import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonicModule, AlertController } from '@ionic/angular';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PasskeyApiService, PasskeyInfo } from 'src/app/core/services/passkey-api.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { environment } from 'src/environments/environment';

@Component({
    selector: 'app-devices',
    template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button defaultHref="/tabs/settings"></ion-back-button>
        </ion-buttons>
        <ion-title>{{ 'devices.title' | translate }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content [fullscreen]="true" class="devices-page">
      <div class="devices-container">
        <p class="devices-subtitle">{{ 'devices.subtitle' | translate }}</p>

        <!-- Loading state -->
        <div *ngIf="loading()" class="loading-state">
          <ion-spinner name="crescent"></ion-spinner>
        </div>

        <!-- Error state -->
        <div *ngIf="error()" class="error-state">
          <ion-icon name="alert-circle-outline"></ion-icon>
          <p>{{ 'devices.load-error' | translate }}</p>
          <ion-button fill="outline" (click)="loadPasskeys()">
            {{ 'devices.retry' | translate }}
          </ion-button>
        </div>

        <!-- Empty state -->
        <div *ngIf="!loading() && !error() && passkeys().length === 0" class="empty-state">
          <ion-icon name="key-outline"></ion-icon>
          <p>{{ 'devices.no-passkeys' | translate }}</p>
        </div>

        <!-- Passkey list -->
        <ion-list *ngIf="!loading() && !error() && passkeys().length > 0" lines="none" class="passkey-list">
          @for (passkey of passkeys(); track passkey.id) {
            <ion-item class="passkey-item">
              <div class="passkey-icon" slot="start">
                <ion-icon name="key-outline"></ion-icon>
              </div>
              <ion-label>
                <h2>{{ passkey.displayName }}</h2>
                <p class="passkey-meta">
                  <span *ngIf="passkey.activeSessions > 0" class="session-badge active">
                    {{ passkey.activeSessions }} {{ passkey.activeSessions === 1 ? 'session' : 'sessions' }}
                  </span>
                  <span *ngIf="passkey.activeSessions === 0" class="session-badge inactive">
                    No active sessions
                  </span>
                </p>
                <p class="passkey-date">
                  Added {{ passkey.createdAt | date:'mediumDate' }}
                </p>
              </ion-label>
              <ion-buttons slot="end">
                <ion-button fill="clear" (click)="renamePasskey(passkey)" [attr.aria-label]="'devices.rename-aria' | translate">
                  <ion-icon slot="icon-only" name="pencil-outline"></ion-icon>
                </ion-button>
                <ion-button fill="clear" color="danger" (click)="deletePasskey(passkey)" [attr.aria-label]="'devices.delete-aria' | translate">
                  <ion-icon slot="icon-only" name="trash-outline"></ion-icon>
                </ion-button>
              </ion-buttons>
            </ion-item>

            <!-- Revoke sessions button (shown if active sessions exist) -->
            <div *ngIf="passkey.activeSessions > 0 && passkey.credentialId !== currentCredentialId" class="revoke-section">
              <ion-button fill="clear" size="small" color="warning" (click)="revokeSessions(passkey)">
                <ion-icon slot="start" name="log-out-outline"></ion-icon>
                Close sessions on this device
              </ion-button>
            </div>
          }
        </ion-list>
      </div>
    </ion-content>
  `,
    styles: [`
    .devices-page {
      --background: var(--surface-page);
    }

    .devices-container {
      max-width: 600px;
      margin: 0 auto;
      padding: var(--space-md);
    }

    .devices-subtitle {
      color: var(--text-secondary);
      font-size: 14px;
      margin-bottom: var(--space-lg);
    }

    .loading-state,
    .error-state,
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: var(--space-xl);
      text-align: center;
      color: var(--text-secondary);

      ion-icon {
        font-size: 48px;
        margin-bottom: var(--space-md);
        opacity: 0.5;
      }
    }

    .passkey-list {
      background: var(--surface-card);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .passkey-item {
      --padding-start: 16px;
      --padding-end: 8px;
      --min-height: 72px;
    }

    .passkey-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--action-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 12px;

      ion-icon {
        color: white;
        font-size: 20px;
      }
    }

    .passkey-meta {
      margin-top: 4px;
    }

    .session-badge {
      font-size: 12px;
      padding: 2px 8px;
      border-radius: 12px;

      &.active {
        background: var(--status-success);
        color: white;
      }

      &.inactive {
        background: var(--text-disabled);
        color: white;
      }
    }

    .passkey-date {
      font-size: 12px;
      color: var(--text-disabled);
      margin-top: 2px;
    }

    .revoke-section {
      padding: 0 16px 12px;
      margin-top: -8px;
    }
  `],
    imports: [IonicModule, CommonModule, FormsModule, TranslateModule]
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class DevicesPage implements OnInit {
  private readonly passkeyApi = inject(PasskeyApiService);
  private readonly passkeyStore = inject(PasskeyStoreService);
  private readonly alertController = inject(AlertController);
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);

  readonly passkeys = signal<PasskeyInfo[]>([]);
  readonly loading = signal(true);
  readonly error = signal(false);

  readonly isServerMode = (environment as any).wallet_mode === 'server';
  readonly currentCredentialId = this.passkeyStore.getCredentialId();

  ngOnInit(): void {
    if (!this.isServerMode) {
      // Redirect to settings if not in server mode
      this.router.navigate(['/tabs/settings']);
      return;
    }
    this.loadPasskeys();
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
    const alert = await this.alertController.create({
      header: this.translate.instant('devices.delete-header'),
      message: this.translate.instant('devices.delete-message'),
      buttons: [
        {
          text: this.translate.instant('devices.cancel'),
          role: 'cancel',
        },
        {
          text: this.translate.instant('devices.delete-confirm'),
          role: 'destructive',
          handler: () => {
            this.passkeyApi.deletePasskey(passkey.id).subscribe({
              next: () => {
                this.passkeys.update(list => list.filter(p => p.id !== passkey.id));
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
}

