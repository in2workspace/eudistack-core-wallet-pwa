import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  computed,
  EventEmitter,
  Input,
  OnInit,
  Output,
  effect,
  inject,
  input,
  signal
} from '@angular/core';
import { QRCodeComponent } from 'angularx-qrcode';
import { WalletService } from 'src/app/core/services/wallet.service';
import { CommonModule } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ExtendedCredentialType, LifeCycleStatus, VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { IonicModule } from '@ionic/angular';
import { DisplayField, DisplaySection } from 'src/app/core/models/display-field.model';
import * as dayjs from 'dayjs';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';
import { CredentialDisplayService } from 'src/app/core/services/credential-display.service';
import { CredentialTypeMap } from 'src/app/core/models/credential-type-map';
import { CredentialVerificationService, VerificationCheck } from 'src/app/core/services/credential-verification.service';

export type ExpiryStatus = 'valid' | 'expiring-soon' | 'expired';

const EXPIRY_WARNING_DAYS = 30;

@Component({
    selector: 'app-vc-view',
    templateUrl: './vc-view.component.html',
    styleUrls: ['./vc-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [IonicModule, QRCodeComponent, TranslateModule, CommonModule]
})
export class VcViewComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private readonly walletService = inject(WalletService);
  private readonly toastService = inject(ToastServiceHandler);
  private readonly displayService = inject(CredentialDisplayService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly verificationService = inject(CredentialVerificationService);

  public credentialInput$ = input.required<VerifiableCredential>();
  public cardFields = signal<DisplayField[]>([]);
  public displayName = signal<string>('');
  public formatLabel = signal<string>('');
  public blurred = input(false);

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

  private readonly loadCardDataEffect = effect(async () => {
    const cred = this.credentialInput$();
    this.cardFields.set(await this.displayService.getCardFields(cred));
    this.displayName.set(await this.displayService.getDisplayName(cred));
    this.formatLabel.set(this.displayService.getFormatLabel(cred));
  });

  @Input() public isDetailViewActive = false;
  @Output() public vcEmit: EventEmitter<VerifiableCredential> =
    new EventEmitter();
  @Output() public statusChanged = new EventEmitter<{ id: string; status: LifeCycleStatus }>();

  credentialType!: ExtendedCredentialType;

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

  public isDetailModalOpen = false;
  public detailViewSections!: DisplaySection[];
  public isVerifyModalOpen = false;
  public verificationChecks: VerificationCheck[] = [];
  public verifyOverall: 'pending' | 'valid' | 'invalid' = 'pending';
  public verifyResultKey: string = 'verification.result-invalid';

  public async openDetailModal(): Promise<void> {
    if(this.isDetailViewActive){
      this.isDetailModalOpen = true;
      await this.getStructuredFields();
    }
  }

  public closeDetailModal(): void {
    this.isDetailModalOpen = false;
  }

  public async verifyCredential(): Promise<void> {
    const keys = this.verificationService.getCheckKeys();
    this.verificationChecks = keys.map(key => ({ key, status: 'pending' as const }));
    this.verifyOverall = 'pending';
    this.isVerifyModalOpen = true;
    this.cdr.markForCheck();

    const credential = this.credentialInput$();

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

    this.cdr.markForCheck();
  }

  public closeVerifyModal(): void {
    this.isVerifyModalOpen = false;
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

  public ngOnInit(): void {
    this.credentialType = getExtendedCredentialType(this.credentialInput$());
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
    this.isDetailModalOpen = false;
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
    return isValidCredentialType(this.credentialType)
      ? CredentialTypeMap[this.credentialType]?.icon
      : undefined;
  }

  public async getStructuredFields(): Promise<void> {
    const vc = this.credentialInput$();

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
        { label: 'vc-fields.credentialInfo.revocationUrl', value: vc.credentialStatus?.id ?? '' },
      ].filter(field => !!field.value && field.value !== ''),
    };

    const detailSections = await this.displayService.getDetailSections(vc);

    const showEncoded = this.credentialType?.startsWith('learcredential.machine.') || this.credentialType?.startsWith('gx.labelcredential.');
    if (showEncoded && vc.credentialEncoded) {
      detailSections.push({
        section: 'vc-fields.credentialEncoded',
        fields: [{ label: 'vc-fields.credentialEncoded', value: vc.credentialEncoded ?? '' }]
      });
    }

    this.detailViewSections = [...detailSections, credentialInfo]
      .filter(section => section.fields.length > 0);
    this.cdr.markForCheck();
  }

  private formatDate(date: string | undefined): string {
    if (!date) return '';
    return dayjs(date).format('DD/MM/YYYY');
  }
}