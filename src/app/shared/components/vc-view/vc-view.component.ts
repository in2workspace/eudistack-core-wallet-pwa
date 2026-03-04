import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
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
import { CredentialSubject, EmployeeCredentialSubject, ExtendedCredentialType, MachineCredentialSubject, VerifiableCredential } from 'src/app/core/models/verifiable-credential';
import { IonicModule } from '@ionic/angular';
import { EvaluatedField, EvaluatedSection } from 'src/app/core/models/credential-detail-map';
import * as dayjs from 'dayjs';
import { ToastServiceHandler } from 'src/app/shared/services/toast.service';
import { getExtendedCredentialType, isValidCredentialType } from 'src/app/shared/helpers/get-credential-type.helpers';
import { CredentialDisplayService } from 'src/app/core/services/credential-display.service';
import { CredentialMapConfig, CredentialTypeMap } from 'src/app/core/models/credential-type-map';



/**
 * This component displays two types of "details VC view":
 * 1. cardViewFields: the summary data displayed in the VC card.
 * 2. detailViewSections: the comprehensive details shown in the modal that opens
 * when clicking on the VC card.
 */
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

  public credentialInput$ = input.required<VerifiableCredential>();
  public cardFields = signal<EvaluatedField[]>([]);
  public displayName = signal<string>('');
  public formatLabel = signal<string>('');

  private readonly loadCardDataEffect = effect(async () => {
    const cred = this.credentialInput$();
    this.cardFields.set(await this.displayService.getCardFields(cred));
    this.displayName.set(await this.displayService.getDisplayName(cred));
    this.formatLabel.set(this.displayService.getFormatLabel(cred));
  });

  @Input() public isDetailViewActive = false;
  @Output() public vcEmit: EventEmitter<VerifiableCredential> =
    new EventEmitter();

  credentialType!: ExtendedCredentialType;

  public cred_cbor = '';
  public isAlertOpenNotFound = false;
  public isAlertExpirationOpenNotFound = false;
  public isAlertOpenDeleteNotFound = false;
  public isModalOpen = false;
  public isModalDeleteOpen = false;
  public isModalUnsignedOpen = false;
  public showChip = false;
  public handlerMessage = '';
  public alertButtons = [
    {
      text: 'OK',
      role: 'confirm',
      handler: () => {
        this.handlerMessage = 'Alert confirmed';
        this.isModalOpen = true;
      },
    },
  ];

  public deleteButtons = [
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

  public unsignedButtons = [{
    text: this.translate.instant("vc-view.delete-close"),
    role: 'close',
    handler: () => {
      this.isModalUnsignedOpen = false;
    },
  }];

  public isDetailModalOpen = false;
  public detailViewSections!: EvaluatedSection[];

  public async openDetailModal(): Promise<void> {
    if(this.isDetailViewActive){
      this.isDetailModalOpen = true;
      await this.getStructuredFields();
    }
  }

  public closeDetailModal(): void {
    this.isDetailModalOpen = false;
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

  get cardViewConfigByCredentialType(): CredentialMapConfig | undefined {
    const credType = this.credentialType;
    return isValidCredentialType(credType) ? CredentialTypeMap[credType] : undefined;
  }

  get iconUrl(): string | undefined {
    return this.cardViewConfigByCredentialType?.icon;
  }

public async getStructuredFields(): Promise<void> {
  const vc = this.credentialInput$();
  const cs = vc.credentialSubject;

  const formatLabel = this.displayService.getFormatLabel(vc);
  const displayNameValue = await this.displayService.getDisplayName(vc);

  const credentialInfo: EvaluatedSection = {
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

  // Try dynamic sections from issuer metadata, fallback to hardcoded
  let detailSections = await this.displayService.getDetailSections(vc);

  // Translate "powers" sections for hardcoded fallback
  detailSections = this.translatePowerSections(detailSections, cs);

  if ((this.credentialType === 'LEARCredentialMachine' || this.credentialType === 'gx:LabelCredential') && vc.credentialEncoded) {
    detailSections.push({
      section: 'vc-fields.credentialEncoded',
      fields: [{ label: 'vc-fields.credentialEncoded', value: vc.credentialEncoded ?? '' }]
    });
  }

  this.detailViewSections = [credentialInfo, ...detailSections]
    .filter(section => section.fields.length > 0);
  this.cdr.markForCheck();
}

private translatePowerSections(
  sections: EvaluatedSection[],
  subject: import('src/app/core/models/verifiable-credential').CredentialSubject
): EvaluatedSection[] {
  const csPowers = this.hasMandate(subject) && Array.isArray(subject.mandate.power)
    ? subject.mandate.power
    : [];

  return sections.map(section => {
    if (!section.section.endsWith('.powers')) return section;

    const translatedFields = section.fields.map((field, idx) => {
      const p = csPowers[idx];
      if (!p) return field;

      const translatedFunction = this.translate.instant(`vc-fields.power.${p.function.toLocaleLowerCase()}`);
      const actions = Array.isArray(p.action) ? p.action : [p.action];
      const translatedActions = actions
        .map((a: string) => this.translate.instant(`vc-fields.power.${a.toLocaleLowerCase()}`))
        .join(', ');

      return {
        label: `${translatedFunction} (${p.domain})`,
        value: translatedActions,
      };
    });

    return { ...section, fields: translatedFields.filter(f => !!f.value && f.value !== '') };
  });
}

/** Type guard: subject has a mandate (employee or machine) */
private hasMandate(
  subject: CredentialSubject
): subject is EmployeeCredentialSubject
   | MachineCredentialSubject {
  return (subject as any)?.mandate !== undefined;
}


  private formatDate(date: string | undefined): string {
    if (!date) {
      return ''; 
    }
    return dayjs(date).format('DD/MM/YYYY');
  }


}