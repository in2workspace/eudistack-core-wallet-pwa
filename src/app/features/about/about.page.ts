import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { BUILD_INFO } from 'src/app/core/constants/build-info.constants';
import { SupportChannels } from 'src/app/core/constants/support.constants';
import { ConfirmModalComponent } from 'src/app/shared/components/confirm-modal/confirm-modal.component';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { SupportChannelService } from './services/support-channel.service';
import { LEGAL_DOCUMENT_IDS } from './models/legal-document.model';

/**
 * AC-01…AC-11 / EC-02 / EC-03 / EC-04.
 * No capability of this section is ever hidden or disabled based on wallet
 * mode (AC-10) — WalletDiscoveryService is consulted only to DISPLAY the
 * current mode in the info panel (moved here from Settings), never to branch
 * which blocks/items render.
 */
@Component({
  selector: 'app-about',
  templateUrl: './about.page.html',
  styleUrls: ['./about.page.scss'],
  imports: [IonicModule, CommonModule, RouterModule, TranslateModule],
})
// eslint-disable-next-line @angular-eslint/component-class-suffix
export class AboutPage implements OnInit, OnDestroy {
  private readonly support = inject(SupportChannelService);
  private readonly modalCtrl = inject(ModalController);
  private readonly translate = inject(TranslateService);
  private readonly discovery = inject(WalletDiscoveryService);

  /** AC-02 — release in execution. Compiled, no network, available offline. */
  readonly buildInfo = BUILD_INFO;

  /** Informational only (moved from Settings) — never used to hide/disable a capability (AC-10). */
  get isServerMode(): boolean {
    return this.discovery.mode() === 'server';
  }
  get walletModeKey(): string {
    return this.isServerMode ? 'settings.wallet-mode-business' : 'settings.wallet-mode-eudiw';
  }

  /** AC-03 — closed catalogue; render order follows LEGAL_DOCUMENT_IDS. */
  readonly legalDocuments = LEGAL_DOCUMENT_IDS;

  /** AC-06 / EC-02 / EC-07 — resolved with tenant → constant precedence. ThemeService is already loaded (APP_INITIALIZER) by the time this page is reachable. */
  readonly channels: SupportChannels = this.support.channels();

  /** AC-07 — mailto with ONLY version and build. */
  readonly supportMailto = this.support.buildSupportMailto();

  /** EC-03 — network-dependent actions (help center, report issue) surface this instead of failing silently. */
  readonly isOffline = signal(!navigator.onLine);

  private readonly handleOnline = () => this.isOffline.set(false);
  private readonly handleOffline = () => this.isOffline.set(true);

  ngOnInit(): void {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  /** EC-04 — the address is always visible as text; copying does not depend on detecting a mailto: failure. */
  async copySupportEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.channels.email);
    } catch {
      // Clipboard API unavailable or permission denied — the address remains visible as plain text.
    }
  }

  /**
   * AC-08/AC-09 — the PII warning is shown before any redirection; the issue
   * tracker only opens after an explicit confirm, never on cancel/backdrop/Escape.
   */
  async reportIssue(): Promise<void> {
    const modal = await this.modalCtrl.create({
      component: ConfirmModalComponent,
      componentProps: {
        icon: 'warning-outline',
        titleKey: 'about.pii-warning.title',
        descriptionKey: 'about.pii-warning.description',
        cancelKey: 'about.pii-warning.cancel',
        actionKey: 'about.pii-warning.confirm',
        actionVariant: 'primary',
      },
      backdropDismiss: false,
      showBackdrop: false,
      cssClass: 'confirm-modal',
    });

    await modal.present();

    const { role } = await modal.onWillDismiss();
    if (role !== 'confirm') return;

    if (!navigator.onLine) {
      alert(this.translate.instant('about.support.offline'));
      return;
    }

    window.open(this.support.buildIssueUrl(), '_blank', 'noopener,noreferrer');
  }
}
