import { Component, DestroyRef, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { BUILD_INFO } from 'src/app/core/constants/build-info.constants';
import { SupportChannels } from 'src/app/core/constants/support.constants';
import { ConfirmModalComponent } from 'src/app/shared/components/confirm-modal/confirm-modal.component';
import { ThemeService } from 'src/app/core/services/theme.service';
import { WalletDiscoveryService } from 'src/app/core/services/wallet-discovery.service';
import { SupportChannelService } from './services/support-channel.service';
import { LegalContentService } from './services/legal-content.service';
import { OssLicenseService } from './services/oss-license.service';
import { OssLicense } from './models/oss-license.model';
import {
  LEGAL_DOCUMENT_IDS,
  LegalDocumentContent,
  LegalDocumentId,
  isLegalDocumentId,
} from './models/legal-document.model';

/** Ids of the collapsible rows: the legal catalogue plus the two local panels. */
type PanelId = LegalDocumentId | 'licenses' | 'contact-support';

type PanelLoadState = 'loading' | 'ready' | 'error';

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
  private readonly legalContent = inject(LegalContentService);
  private readonly ossLicenseService = inject(OssLicenseService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

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

  /** Branding name of the tenant serving this wallet ("Wallet provider" block). */
  readonly providerName = this.theme.snapshot?.branding?.name ?? null;

  /** EC-03 — network-dependent actions (help center, report issue) surface this instead of failing silently. */
  readonly isOffline = signal(!navigator.onLine);

  /** At most one panel is open at a time, as the mock draws it. */
  readonly expandedPanel = signal<PanelId | null>(null);

  // --- Legal document panel ---------------------------------------------------
  readonly legalState = signal<PanelLoadState>('loading');
  readonly legalDocument = signal<LegalDocumentContent | null>(null);

  // --- Licenses panel ---------------------------------------------------------
  readonly licensesState = signal<PanelLoadState>('loading');
  readonly licenses = signal<readonly OssLicense[]>([]);

  /** Transient confirmation shown next to the copy action (EC-04). */
  readonly emailCopied = signal(false);

  readonly expandedLegalDoc = computed(() => {
    const panel = this.expandedPanel();
    return isLegalDocumentId(panel) ? panel : null;
  });

  private legalSubscription?: Subscription;
  private copyFeedbackTimer?: ReturnType<typeof setTimeout>;

  private readonly handleOnline = () => this.isOffline.set(false);
  private readonly handleOffline = () => this.isOffline.set(true);

  ngOnInit(): void {
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
    this.legalSubscription?.unsubscribe();
    clearTimeout(this.copyFeedbackTimer);
  }

  backToWallet(): void {
    void this.router.navigate(['/tabs/credentials']);
  }

  isExpanded(panel: PanelId): boolean {
    return this.expandedPanel() === panel;
  }

  togglePanel(panel: PanelId): void {
    if (this.isExpanded(panel)) {
      this.collapse();
      return;
    }

    this.legalSubscription?.unsubscribe();
    this.expandedPanel.set(panel);

    if (isLegalDocumentId(panel)) {
      this.loadLegalDocument(panel);
      return;
    }
    if (panel === 'licenses') {
      this.loadLicenses();
    }
  }

  collapse(): void {
    this.legalSubscription?.unsubscribe();
    this.expandedPanel.set(null);
  }

  retryLegalDocument(): void {
    const docId = this.expandedLegalDoc();
    if (docId) {
      this.loadLegalDocument(docId);
    }
  }

  /** EC-04 — the address is always visible as text; copying does not depend on detecting a mailto: failure. */
  async copySupportEmail(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.channels.email);
      this.emailCopied.set(true);
      clearTimeout(this.copyFeedbackTimer);
      this.copyFeedbackTimer = setTimeout(() => this.emailCopied.set(false), 2000);
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

  private loadLegalDocument(docId: LegalDocumentId): void {
    this.legalSubscription?.unsubscribe();
    this.legalState.set('loading');
    this.legalDocument.set(null);

    this.legalSubscription = this.legalContent
      .load(docId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if (this.expandedPanel() !== docId) return; // superseded by another row
        if (result.status === 'ready') {
          this.legalDocument.set(result.content);
          this.legalState.set('ready');
          return;
        }
        this.legalState.set('error');
      });
  }

  private loadLicenses(): void {
    if (this.licenses().length > 0) {
      this.licensesState.set('ready');
      return;
    }
    this.licensesState.set('loading');

    this.ossLicenseService
      .load()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((licenses) => {
        this.licenses.set(licenses);
        this.licensesState.set(licenses.length > 0 ? 'ready' : 'error');
      });
  }
}
