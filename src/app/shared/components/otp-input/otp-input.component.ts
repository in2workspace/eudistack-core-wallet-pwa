import {
  Component,
  EventEmitter,
  Input,
  Output,
  ViewChildren,
  QueryList,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-otp-input',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="otp-container">
      <input
        *ngFor="let d of digits; let i = index"
        #otpBox
        type="text"
        inputmode="numeric"
        maxlength="1"
        class="otp-box"
        [class.filled]="digits[i] !== ''"
        [class.error]="error"
        [value]="digits[i]"
        (input)="onInput($event, i)"
        (keydown)="onKeydown($event, i)"
        (paste)="onPaste($event)"
        (focus)="onFocus(i)"
      />
    </div>
  `,
  styles: [`
    .otp-container {
      display: flex;
      justify-content: center;
      gap: 8px;
    }

    .otp-box {
      width: 46px;
      height: 54px;
      border: 2px solid var(--action-secondary-hover, #E5E7EB);
      border-radius: 12px;
      background: var(--surface-page, #F5F7FA);
      font-size: 1.4rem;
      font-weight: 700;
      text-align: center;
      color: var(--text-primary, #1A1A2E);
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
      caret-color: var(---primary-color);

      &:focus {
        border-color: var(--neutral-medium);
        box-shadow: 0 0 0 3px rgb(var(--primary-color-rgb, 37, 99, 235), 0.12);
        background: var(--surface-card, #FFFFFF);
      }

      &.filled {
        border-color: var(--primary-color);
        background: var(--surface-card, #FFFFFF);
      }

      &.error {
        border-color: var(--status-error, #DC2626);
        animation: shake 0.3s ease;
      }
    }

    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-4px); }
      75% { transform: translateX(4px); }
    }
  `],
})
export class OtpInputComponent implements AfterViewInit {
  @ViewChildren('otpBox') boxes!: QueryList<ElementRef<HTMLInputElement>>;

  /** Number of digit boxes (4 for PIN, 6 for email OTP) */
  @Input() length = 6;

  /** Whether to auto-focus the first box on init */
  @Input() autofocus = false;

  /** Show error styling */
  @Input() error = false;

  /** Emits the complete code when all digits are filled */
  @Output() completed = new EventEmitter<string>();

  /** Emits partial value on every change */
  @Output() changed = new EventEmitter<string>();

  digits: string[] = [];

  ngOnChanges(): void {
    if (this.digits.length !== this.length) {
      this.digits = Array(this.length).fill('');
    }
  }

  ngOnInit(): void {
    this.digits = Array(this.length).fill('');
  }

  ngAfterViewInit(): void {
    if (this.autofocus) {
      setTimeout(() => this.focusBox(0), 100);
    }
  }

  get value(): string {
    return this.digits.join('');
  }

  /** Programmatic reset */
  reset(): void {
    this.digits = Array(this.length).fill('');
    this.focusBox(0);
  }

  onInput(event: Event, index: number): void {
    const input = event.target as HTMLInputElement;
    const val = input.value.replace(/\D/g, '');

    if (val) {
      this.digits[index] = val[0];
      input.value = val[0];

      if (index < this.length - 1) {
        this.focusBox(index + 1);
      }

      this.changed.emit(this.value);

      if (this.value.length === this.length) {
        this.completed.emit(this.value);
      }
    } else {
      this.digits[index] = '';
      input.value = '';
      this.changed.emit(this.value);
    }
  }

  onKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Backspace') {
      if (this.digits[index] === '' && index > 0) {
        this.digits[index - 1] = '';
        this.focusBox(index - 1);
        event.preventDefault();
      } else {
        this.digits[index] = '';
      }
      this.changed.emit(this.value);
    } else if (event.key === 'ArrowLeft' && index > 0) {
      this.focusBox(index - 1);
      event.preventDefault();
    } else if (event.key === 'ArrowRight' && index < this.length - 1) {
      this.focusBox(index + 1);
      event.preventDefault();
    } else if (event.key === 'Enter' && this.value.length === this.length) {
      this.completed.emit(this.value);
    }
  }

  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = (event.clipboardData?.getData('text') || '')
      .replace(/\D/g, '')
      .slice(0, this.length);
    if (!pasted) return;

    for (let i = 0; i < this.length; i++) {
      this.digits[i] = pasted[i] || '';
    }

    const nextEmpty = this.digits.findIndex(d => d === '');
    this.focusBox(nextEmpty >= 0 ? nextEmpty : this.length - 1);

    this.changed.emit(this.value);

    if (this.value.length === this.length) {
      this.completed.emit(this.value);
    }
  }

  onFocus(index: number): void {
    const boxes = this.boxes?.toArray();
    if (boxes?.[index]) {
      boxes[index].nativeElement.select();
    }
  }

  private focusBox(index: number): void {
    const boxes = this.boxes?.toArray();
    if (boxes?.[index]) {
      boxes[index].nativeElement.focus();
    }
  }
}
