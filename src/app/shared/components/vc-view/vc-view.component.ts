import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  EventEmitter,
  HostListener,
  Output,
  effect,
  inject,
  input,
  OnDestroy,
  signal
} from '@angular/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EmployeeCredentialSubject, ExtendedCredentialType, LifeCycleStatus, VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { IonicModule } from '@ionic/angular';
import { DisplayField, DisplayFieldItem, DisplaySection } from 'src/app/core/models/display-field.model';
import dayjs from 'dayjs';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';
import { CredentialDisplayService } from 'src/app/core/services/credential-display.service';
import { CredentialTypeMap } from 'src/app/core/models/credential-type-map';
import { CredentialVerificationService, VerificationCheck } from 'src/app/core/services/credential-verification.service';
import { Router } from '@angular/router';

export type ExpiryStatus = 'valid' | 'expiring-soon' | 'expired';
export type CardStatusTone = 'verified' | 'expired' | 'revoked';

export interface PreviewField {
  label: string;
  value: string;
}

export interface VerificationRow {
  key: string;
  label: string;
  value: string;
  status: 'idle' | 'checking' | 'passed' | 'failed';
}

const VERIFICATION_ROW_LABELS: Record<string, string> = {
  issuance: 'verification.row-issuance',
  expiration: 'verification.row-expiration',
  issuer: 'verification.row-issuer',
  status: 'verification.row-revocation',
};

const EXPIRY_WARNING_DAYS = 30;
const VERIFY_COOLDOWN_MS = 5000;
const VERIFY_RESULT_MS = 2000;

const HIDDEN_VALUE = '*'.repeat(15);

const LIFECYCLE_LABELS: Record<LifeCycleStatus, string> = {
  VALID: 'vc-view.lifecycle-valid',
  ISSUED: 'vc-view.lifecycle-issued',
  REVOKED: 'vc-view.lifecycle-revoked',
  EXPIRED: 'vc-view.lifecycle-expired',
};

@Component({
    selector: 'app-vc-view',
    templateUrl: './vc-view.component.html',
    styleUrls: ['./vc-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IonicModule, QRCodeComponent, TranslateModule, CommonModule]
})
export class VcViewComponent implements OnDestroy {
  private readonly translate = inject(TranslateService);
  private readonly walletService = inject(WalletService);
  private readonly toastService = inject(ToastServiceHandler);
  private readonly displayService = inject(CredentialDisplayService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly verificationService = inject(CredentialVerificationService);
  private readonly router = inject(Router);
  
  public credentialInput$ = input.required<VerifiableCredential>();
  public detailViewSections$ = signal<DisplaySection[]>([]);
  public cardFields = signal<DisplayField[]>([]);
  public displayName = signal<string>('');
  public formatLabel = signal<string>('');

  public blurred = input(false);
  public selectedVcId = input<string | null>(null);
  public enableDetailView$ = input(true);

  public isDetailViewActive$ = computed(
    () => this.enableDetailView$() && (this.selectedVcId() === this.credentialInput$().id)
  );

  public expiryStatus = computed<ExpiryStatus>(() => {
    const cred = this.credentialInput$();
    if (!cred.validUntil) return 'valid';
    const now = dayjs();
    const expiry = dayjs(cred.validUntil);
    if (!expiry.isValid()) return 'valid';
    if (expiry.isBefore(now)) return 'expired';
    if (expiry.diff(now, 'day') <= EXPIRY_WARNING_DAYS) return 'expiring-soon';
    return 'valid';
  });

  public daysUntilExpiry = computed<number | null>(() => {
    const cred = this.credentialInput$();
    if (!cred.validUntil) return null;
    const expiry = dayjs(cred.validUntil);
    if (!expiry.isValid()) return null;
    const days = expiry.diff(dayjs(), 'day');
    return days >= 0 ? days : null;
  });

  public readonly statusBadge = computed<{ label: string; tone: CardStatusTone }>(() => {
    const cred = this.credentialInput$();
    if (cred.lifeCycleStatus === 'REVOKED') {
      return { label: 'vc-view.badge-revoked', tone: 'revoked' };
    }
    if (cred.lifeCycleStatus === 'EXPIRED' || this.expiryStatus() === 'expired') {
      return { label: 'vc-view.badge-expired', tone: 'expired' };
    }
    return { label: 'vc-view.badge-verified', tone: 'verified' };
  });

  public readonly previewFields = computed<PreviewField[]>(() => {
    const cred = this.credentialInput$();
    const hidden = this.blurred();
    const issuerId = cred.issuer?.organizationIdentifier || cred.issuer?.id || '';
    const expiry = cred.validUntil && dayjs(cred.validUntil).isValid()
      ? dayjs(cred.validUntil).format('DD/MM/YYYY')
      : '';

    return [
      { label: 'vc-view.preview-name', value: hidden ? HIDDEN_VALUE : this.subjectName(cred) },
      { label: 'vc-view.preview-issuer', value: hidden ? HIDDEN_VALUE : issuerId },
      { label: 'vc-view.preview-status', value: this.translate.instant(LIFECYCLE_LABELS[cred.lifeCycleStatus]) },
      { label: 'vc-view.preview-expiry', value: hidden ? HIDDEN_VALUE : expiry },
    ];
  });

  public get issuedBy(): string {
    const issuer = this.credentialInput$().issuer;
    return issuer?.commonName || issuer?.organization || '';
  }

  public get verificationRows(): VerificationRow[] {
    const cred = this.credentialInput$();
    const byKey = new Map(this.verificationChecks.map(c => [c.key, c.status]));
    const asDate = (raw?: string) =>
      raw && dayjs(raw).isValid() ? dayjs(raw).format('DD/MM/YYYY') : '';

    const values: Record<string, string> = {
      issuance: asDate(cred.validFrom),
      expiration: asDate(cred.validUntil),
      issuer: cred.issuer?.organizationIdentifier || cred.issuer?.id || '',
      status: '',
    };

    return Object.keys(VERIFICATION_ROW_LABELS).map(key => ({
      key,
      label: VERIFICATION_ROW_LABELS[key],
      value: values[key],
      status: (byKey.get(key) as VerificationRow['status'])
        ?? (this.statusBadge().tone === 'verified' ? 'passed' : 'failed'),
    }));
  }

  public isPowersSection(section: DisplaySection): boolean {
    return section.fields.some(field => !!field.structured?.length);
  }

  public isWideField(field: DisplayField): boolean {
    return (field.value?.length ?? 0) > 24;
  }

  /**
   * Placeholder: the mock shows an Execute action per power but the behaviour
   * is not specified yet, so this only surfaces a notice.
   */
  public executePower(item: DisplayFieldItem): void {
    console.warn('Power execution not implemented yet', item);
    this.toastService.showErrorAlertByTranslateLabel('vc-fields.execute-unavailable').subscribe();
  }

  private subjectName(cred: VerifiableCredential): string {
    const mandatee = (cred.credentialSubject as Partial<EmployeeCredentialSubject>)?.mandate?.mandatee;
    const fullName = [mandatee?.firstName, mandatee?.lastName].filter(Boolean).join(' ');
    if (fullName) return fullName;

    return this.cardFields().slice(0, 2).map(f => f.value).filter(Boolean).join(' ');
  }

  private readonly loadCardDataEffect = effect(async () => {
    const cred = this.credentialInput$();
    this.cardFields.set(await this.displayService.getCardFields(cred));
    this.displayName.set(await this.displayService.getDisplayName(cred));
    this.formatLabel.set(this.displayService.getFormatLabel(cred));
  });

  private readonly _loadDetailSectionsEffect = effect(async () => {
    if (!this.isDetailViewActive$()) {
      return;
    }
    await this.updateDetailSections(this.credentialInput$());
  });
  
  @Output() public vcEmit: EventEmitter<VerifiableCredential> =
    new EventEmitter();
  @Output() public statusChanged = new EventEmitter<{ id: string; status: LifeCycleStatus }>();

  public readonly credentialType = computed<ExtendedCredentialType>(
    () => getExtendedCredentialType(this.credentialInput$())
  );

  public cred_cbor = '';
  public isAlertOpenNotFound = false;
  public isAlertExpirationOpenNotFound = false;
  public isAlertOpenDeleteNotFound = false;
  public isModalOpen = false;
  public isModalDeleteOpen = false;
  public isModalUnsignedOpen = false;

  public readonly alertButtons = [
    {
      text: 'OK',
      role: 'confirm',
      handler: () => {
        this.isModalOpen = true;
      },
    },
  ];

  public readonly deleteButtons = [
    {
      text: this.translate.instant("vc-view.delete-cancel"),
      role: 'cancel',
      handler: () => {
        this.isModalDeleteOpen = false;
      },
    },
    {
      text: this.translate.instant("vc-view.delete-confirm"),
      role: 'confirm',
      handler: () => {
        this.isModalDeleteOpen = true;
        this.vcEmit.emit(this.credentialInput$());
      },
    },
  ];

  public readonly unsignedButtons = [{
    text: this.translate.instant("vc-view.delete-close"),
    role: 'close',
    handler: () => {
      this.isModalUnsignedOpen = false;
    },
  }];

  public isVerifyModalOpen = false;
  public isVerifying = false;
  public showVerifyResult = false;
  public verifyLocked = false;
  private verifyCooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private verifyResultTimer: ReturnType<typeof setTimeout> | null = null;
  public verificationChecks: VerificationCheck[] = [];
  public verifyOverall: 'pending' | 'valid' | 'invalid' = 'pending';
  public verifyResultKey: string = 'verification.result-invalid';

  public async openDetailModal(): Promise<void> {
    if (!this.enableDetailView$()) {
      return;
    }
    
    const vc = this.credentialInput$();
    if (!vc.id) {
      return;
    }
    this.router.navigate(['/tabs/credentials'], {
      queryParams: { id: vc.id },
      queryParamsHandling: 'merge',
    });
  }

  public closeDetailModal(): void {
    if (this.isDetailViewActive$()) { 
      this.router.navigate(['/tabs/credentials'], {
        queryParams: { id: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      });
      return;
    }
  }

  @HostListener('window:popstate')
  public onPopstate(): void {
    if (this.isVerifyModalOpen) {
      this.isVerifyModalOpen = false;
      this.cdr.markForCheck();
    }
  }

  public async verifyCredential(): Promise<void> {
    if (this.verifyLocked) return;
    this.verifyLocked = true;

    const keys = this.verificationService.getCheckKeys();
    this.verificationChecks = keys.map(key => ({ key, status: 'pending' as const }));
    this.verifyOverall = 'pending';
    this.isVerifying = true;
    this.cdr.markForCheck();
    
    const credential = this.credentialInput$();
    
    try {
      for (let i = 0; i < keys.length; i++) {
        await this.delay(400);
        this.verificationChecks[i] = { ...this.verificationChecks[i], status: 'checking' };
        this.cdr.markForCheck();
        
        await this.delay(600);
        const result = await this.verificationService.runCheck(keys[i], credential);
        this.verificationChecks[i] = result;
        this.cdr.markForCheck();
      }
      
      await this.delay(400);
      const allPassed = this.verificationChecks.every(c => c.status === 'passed');
      this.verifyOverall = allPassed ? 'valid' : 'invalid';
  
      if (!allPassed) {
        const statusCheck = this.verificationChecks.find(c => c.key === 'status');
        const expirationCheck = this.verificationChecks.find(c => c.key === 'expiration');
  
        if (statusCheck?.status === 'failed' && statusCheck?.detail === 'revoked') {
          this.verifyResultKey = 'verification.result-revoked';
          this.updateLifeCycleStatus('REVOKED');
        } else if (expirationCheck?.status === 'failed') {
          this.verifyResultKey = 'verification.result-expired';
          this.updateLifeCycleStatus('EXPIRED');
        } else {
          this.verifyResultKey = 'verification.result-invalid';
        }
      }
    } catch {
      // TODO: Review behavior in case of error
      this.verifyOverall = 'invalid';
    }

    this.isVerifying = false;
    this.showVerifyResult = true;
    this.startVerifyResultTimer();
    this.startVerifyCooldown();
    this.cdr.markForCheck();
  }

  private startVerifyResultTimer(): void {
    if (this.verifyResultTimer !== null) {
      clearTimeout(this.verifyResultTimer);
    }
    this.verifyResultTimer = setTimeout(() => {
      this.verifyResultTimer = null;
      this.showVerifyResult = false;
      this.cdr.markForCheck();
    }, VERIFY_RESULT_MS);
  }

  private startVerifyCooldown(): void {
    if (this.verifyCooldownTimer !== null) {
      clearTimeout(this.verifyCooldownTimer);
    }
    this.verifyCooldownTimer = setTimeout(() => {
      this.verifyCooldownTimer = null;
      this.verifyLocked = false;
      this.cdr.markForCheck();
    }, VERIFY_COOLDOWN_MS);
  }

  public ngOnDestroy(): void {
    if (this.verifyResultTimer !== null) {
      clearTimeout(this.verifyResultTimer);
    }
    if (this.verifyCooldownTimer !== null) {
      clearTimeout(this.verifyCooldownTimer);
    }
  }

  public closeVerifyModal(): void {
    if (!this.isVerifyModalOpen) {
      return;
    }
    this.isVerifyModalOpen = false;
    history.back();
  }

  private updateLifeCycleStatus(status: LifeCycleStatus): void {
    const cred = this.credentialInput$();
    if (cred.lifeCycleStatus === status) return;
    this.walletService.updateCredentialStatus(cred.id, status).subscribe({
      error: (e) => console.error('Failed to persist credential status', e),
    });
    this.statusChanged.emit({ id: cred.id, status });
    this.cdr.markForCheck();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public async copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toastService.showToast('vc-fields.copy-success');
    } catch (err) {
      console.error('Error al copiar', err);
    }
  }

  public qrView(): void {
    if (this.credentialInput$().lifeCycleStatus !== "EXPIRED") {
      this.walletService.getVCinCBOR(this.credentialInput$()).subscribe({
        next: (value: string) => {
          this.cred_cbor = value;
          this.isAlertOpenNotFound = false;
        },
        error: (error: unknown) => {
          console.error('Error fetching VC in CBOR format:', error);
          this.isAlertOpenNotFound = true;
        },
      });
    } else {
      this.isAlertExpirationOpenNotFound = true;
    }
  }

  public deleteVC(): void {
    this.isModalDeleteOpen = true;  
    this.router.navigate(['/tabs/credentials'], {
      queryParams: { id: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  public unsignedInfo(event: Event): void {
    event.stopPropagation();
    this.isModalUnsignedOpen = true;
  }

  public setOpen(isOpen: boolean): void {
    this.isModalOpen = isOpen;
  }

  public setOpenNotFound(isOpen: boolean): void {
    this.isAlertOpenNotFound = isOpen;
  }

  public setOpenDeleteNotFound(isOpen: boolean): void {
    this.isAlertOpenDeleteNotFound = isOpen;
  }

  public setOpenExpirationNotFound(isOpen: boolean): void {
    this.isAlertExpirationOpenNotFound = isOpen;
  }

  public handleKeydown(event: KeyboardEvent, action = 'request') {
    if (event.key === 'Enter' || event.key === ' ') {
      if (action === 'qr') {
        this.qrView();
      }
      event.preventDefault();
    }
  }

  public handleButtonKeydown(event: KeyboardEvent, action: string): void {
    if (event.key === 'Enter' || event.key === ' ') {
      if (action === 'delete') {
        this.deleteVC();
      } else if (action === 'close') {
        this.setOpen(false);
      } else if (action === 'info') {
        this.unsignedInfo(event);
      } else if (action === 'detail') {
        this.openDetailModal();
      }
      event.preventDefault();
    }
  }

  get iconUrl(): string | undefined {
    const type = this.credentialType();
    return isValidCredentialType(type)
      ? CredentialTypeMap[type]?.icon
      : undefined;
  }

  private async updateDetailSections(vc: VerifiableCredential): Promise<void> {
    const formatLabel = this.displayService.getFormatLabel(vc);
    const displayNameValue = await this.displayService.getDisplayName(vc);

    const credentialInfo: DisplaySection = {
      section: 'vc-fields.title',
      fields: [
        { label: 'vc-fields.credentialInfo.type', value: displayNameValue },
        ...(formatLabel ? [{ label: 'vc-fields.credentialInfo.format', value: formatLabel }] : []),
        { label: 'vc-fields.credentialInfo.issuerId', value: typeof vc.issuer === 'string' ? vc.issuer : (vc.issuer?.id ?? '') },
        { label: 'vc-fields.credentialInfo.issuerOrganization', value: vc.issuer?.organization ?? '' },
        { label: 'vc-fields.credentialInfo.validFrom', value: this.formatDate(vc.validFrom) },
        { label: 'vc-fields.credentialInfo.validUntil', value: this.formatDate(vc.validUntil) },
        { label: 'vc-fields.credentialInfo.status', value: vc.lifeCycleStatus ?? '' },
      ].filter(field => !!field.value && field.value !== ''),
    };

    const detailSections = await this.displayService.getDetailSections(vc);

    const credentialType = getExtendedCredentialType(vc);
    const showEncoded = credentialType?.startsWith('learcredential.machine.')
    || credentialType?.startsWith('gx.labelcredential.')
    || credentialType === "LEARCredentialMachine"
    || credentialType === 'gx:LabelCredential';
    
    if (showEncoded && vc.credentialEncoded) {
      detailSections.push({
        section: 'vc-fields.credentialEncoded',
        fields: [{ label: 'vc-fields.credentialEncoded', value: vc.credentialEncoded ?? '' }]
      });
    }

    this.detailViewSections$.set(
      [credentialInfo, ...detailSections].filter(section => section.fields.length > 0)
    );
    this.cdr.markForCheck();
  }

  private formatDate(date: string | undefined): string {
    if (!date) return '';
    return dayjs(date).format('DD/MM/YYYY');
  }
}