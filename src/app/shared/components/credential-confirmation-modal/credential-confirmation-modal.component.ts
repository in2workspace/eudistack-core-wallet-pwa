import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  Input,
  OnDestroy,
  OnInit,
  QueryList,
  ViewChildren,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { CredentialPreview } from '../../../core/models/credential-preview';
import { DisplayField, DisplaySection } from '../../../core/models/display-field.model';

/** Gap between fields of the same row — keep in sync with `.field-grid` in the SCSS. */
const FIELD_GAP_PX = 12;
/** Bounds for the content-derived width of a field, in `ch`. */
const FIELD_MIN_CH = 12;
const FIELD_MAX_CH = 60;

interface FieldVm {
  label: string;
  value: string;
  /** Content-derived floor so a field only shares a row when it still reads in full. */
  minWidth: string;
}

interface PowerVm {
  /** `function (domain)` */
  name: string;
  actions: string[];
}

interface SectionVm {
  title: string;
  fields: FieldVm[];
  powers: PowerVm[];
}

@Component({
  selector: 'app-credential-confirmation-modal',
  standalone: true,
  imports: [CommonModule, IonicModule, TranslateModule],
  templateUrl: './credential-confirmation-modal.component.html',
  styleUrl: './credential-confirmation-modal.component.scss',
})
export class CredentialConfirmationModalComponent implements OnInit, AfterViewInit, OnDestroy {

  @Input() public preview!: CredentialPreview;
  @Input() public timeoutSeconds = 80;

  @ViewChildren('powerActions') private readonly powerActionRefs?: QueryList<ElementRef<HTMLElement>>;

  public animateIn = false;
  public remainingSeconds = 0;
  public formattedExpiration = '';
  public sections: SectionVm[] = [];

  private readonly modalCtrl = inject(ModalController);
  private readonly translate = inject(TranslateService);

  private interval: ReturnType<typeof setInterval> | undefined;
  private powerActionsSub: Subscription | undefined;

  public get countdownPercent(): number {
    if (this.timeoutSeconds <= 0) return 0;
    return (this.remainingSeconds / this.timeoutSeconds) * 100;
  }

  /** Remaining time as `mm:ss`. */
  public get formattedRemaining(): string {
    const total = Math.max(0, this.remainingSeconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  public ngOnInit(): void {
    this.remainingSeconds = this.timeoutSeconds;
    this.formattedExpiration = this.formatDate(this.preview?.expirationDate ?? '');
    this.sections = this.buildSections();
  }

  public ngAfterViewInit(): void {
    this.syncPowerActionLayout();
    this.powerActionsSub = this.powerActionRefs?.changes.subscribe(() => this.syncPowerActionLayout());
    window.addEventListener('resize', this.onWindowResize);
  }

  public ngOnDestroy(): void {
    window.removeEventListener('resize', this.onWindowResize);
    this.powerActionsSub?.unsubscribe();
    this.clearCountdown();
  }

  public ionViewDidEnter(): void {
    this.animateIn = true;
    this.startCountdown();
    this.syncPowerActionLayout();
  }

  public ionViewWillLeave(): void {
    this.clearCountdown();
  }

  public onAccept(): void {
    this.clearCountdown();
    this.modalCtrl.dismiss(null, 'confirm');
  }

  public onReject(): void {
    this.clearCountdown();
    this.modalCtrl.dismiss(null, 'cancel');
  }

  private buildSections(): SectionVm[] {
    const sections = (this.preview?.sections ?? []).map(section => this.toSectionVm(section));
    this.appendFormatField(sections);
    return sections;
  }

  private toSectionVm(section: DisplaySection): SectionVm {
    const powers: PowerVm[] = [];
    const fields: FieldVm[] = [];

    for (const field of section.fields) {
      if (field.structured?.length) {
        powers.push(...field.structured.map(item => ({
          name: item.label,
          actions: item.values ?? (item.value ? [item.value] : []),
        })));
        continue;
      }
      fields.push(this.toFieldVm(field));
    }

    return { title: section.section, fields, powers };
  }

  private toFieldVm(field: DisplayField): FieldVm {
    return { label: field.label, value: field.value, minWidth: this.fieldMinWidth(field) };
  }

  /**
   * A field never drops below a third of the row (so a row holds 3 at most) nor
   * below the width its own content needs, and never exceeds the full row.
   */
  private fieldMinWidth(field: DisplayField): string {
    const chars = Math.max(field.label?.length ?? 0, field.value?.length ?? 0) + 3;
    const contentCh = Math.min(Math.max(chars, FIELD_MIN_CH), FIELD_MAX_CH);
    const third = `calc((100% - 2 * ${FIELD_GAP_PX}px) / 3)`;
    return `min(100%, max(${third}, ${contentCh}ch))`;
  }

  /** The credential format is not part of the claims, so it is shown as one more field. */
  private appendFormatField(sections: SectionVm[]): void {
    const format = this.preview?.format;
    if (!format) return;

    const field: DisplayField = { label: this.translate.instant('confirmation.format'), value: format };
    const target = sections.find(section => section.powers.length === 0);

    if (target) {
      target.fields.push(this.toFieldVm(field));
    } else {
      sections.push({ title: '', fields: [this.toFieldVm(field)], powers: [] });
    }
  }

  private readonly onWindowResize = (): void => this.syncPowerActionLayout();

  /** Stacks a power's actions as soon as they no longer fit side by side. */
  private syncPowerActionLayout(): void {
    for (const ref of this.powerActionRefs ?? []) {
      const el = ref.nativeElement;
      el.classList.remove('stacked');
      if (el.scrollWidth > el.clientWidth + 1) {
        el.classList.add('stacked');
      }
    }
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString(this.translate.currentLang || 'es-ES', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  private startCountdown(): void {
    if (this.timeoutSeconds <= 0) return;
    this.interval = globalThis.setInterval(() => {
      this.remainingSeconds--;
      if (this.remainingSeconds <= 0) {
        this.clearCountdown();
        this.modalCtrl.dismiss(null, 'timeout');
      }
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.interval != null) {
      globalThis.clearInterval(this.interval);
      this.interval = undefined;
    }
  }
}
