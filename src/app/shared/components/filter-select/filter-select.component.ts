import { ChangeDetectionStrategy, Component, computed, input, output, signal, viewChild } from '@angular/core';
import { IonicModule, IonPopover } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';

export interface FilterOption {
  value: string;
  label: string;
  /** The label is a translation key, not a text to show as it is. */
  translate?: boolean;
}

let nextTriggerId = 0;

/**
 * A filter shown as a pill (its name and the chosen value) that opens a menu of options. The menu is an
 * `ion-popover` instead of a native `<select>`, so it can follow the look of the app. An empty value means
 * "no filter" and is always the first option.
 */
@Component({
  selector: 'app-filter-select',
  imports: [IonicModule, TranslateModule],
  templateUrl: './filter-select.component.html',
  styleUrls: ['./filter-select.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilterSelectComponent {
  /** Translation key of the name of the filter. */
  readonly label = input.required<string>();
  readonly value = input('');
  readonly options = input<FilterOption[]>([]);
  readonly valueChange = output<string>();

  protected readonly triggerId = `filter-select-${nextTriggerId++}`;
  protected readonly open = signal(false);
  protected readonly active = computed(() => this.value() !== '');
  protected readonly selected = computed(() => this.options().find(option => option.value === this.value()));

  private readonly popover = viewChild(IonPopover);

  public choose(value: string): void {
    this.valueChange.emit(value);
    void this.popover()?.dismiss();
  }
}
