import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { OtpInputComponent } from './otp-input.component';

describe('OtpInputComponent', () => {
  let component: OtpInputComponent;
  let fixture: ComponentFixture<OtpInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OtpInputComponent, TranslateModule.forRoot()]
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', { 'otp-input': { 'digit-aria': 'Digit {{index}} of {{length}}' } });
    translate.use('en');

    fixture = TestBed.createComponent(OtpInputComponent);
    component = fixture.componentInstance;
    component.length = 6;
    fixture.detectChanges();
  });

  function boxes(): HTMLInputElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('input.otp-box'));
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should render one box per digit of length', () => {
    expect(boxes()).toHaveLength(6);
  });

  describe('digit entry', () => {
    it('should store the digit and move focus to the next box on input', () => {
      const spy = jest.spyOn(component as any, 'focusBox');
      const box0 = boxes()[0];
      box0.value = '5';
      box0.dispatchEvent(new Event('input'));

      expect(component.digits[0]).toBe('5');
      // focusBox(1) is scheduled via setTimeout(0)
      jest.useFakeTimers();
      component.onInput({ target: box0 } as unknown as Event, 0);
      jest.runAllTimers();
      expect(spy).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should ignore non-numeric characters', () => {
      const input = { target: { value: 'a' } } as unknown as Event;
      component.onInput(input, 0);
      expect(component.digits[0]).toBe('');
    });

    it('should emit the completed code when all digits are filled via Enter', () => {
      const completedSpy = jest.spyOn(component.completed, 'emit');
      component.digits = ['1', '2', '3', '4', '5', '6'];

      component.onKeydown({ key: 'Enter', preventDefault: () => {} } as unknown as KeyboardEvent, 5);

      expect(completedSpy).toHaveBeenCalledWith('123456');
    });

    it('should emit partial value on change', () => {
      const changedSpy = jest.spyOn(component.changed, 'emit');
      component.onInput({ target: { value: '7' } } as unknown as Event, 2);
      expect(changedSpy).toHaveBeenCalledWith(component.value);
    });
  });

  describe('backspace / arrows', () => {
    beforeEach(() => {
      component.digits = ['1', '2', '', '', '', ''];
    });

    it('should clear the current digit on Backspace without moving if it has a value', () => {
      component.onKeydown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent, 1);
      expect(component.digits[1]).toBe('');
    });

    it('should clear the previous digit and move back on Backspace when current is empty', () => {
      component.onKeydown({ key: 'Backspace', preventDefault: () => {} } as unknown as KeyboardEvent, 2);
      expect(component.digits[1]).toBe('');
    });

    it('should move focus left on ArrowLeft', () => {
      const spy = jest.spyOn(component as any, 'focusBox');
      component.onKeydown({ key: 'ArrowLeft', preventDefault: () => {} } as unknown as KeyboardEvent, 1);
      expect(spy).toHaveBeenCalledWith(0);
    });

    it('should move focus right on ArrowRight', () => {
      const spy = jest.spyOn(component as any, 'focusBox');
      component.onKeydown({ key: 'ArrowRight', preventDefault: () => {} } as unknown as KeyboardEvent, 1);
      expect(spy).toHaveBeenCalledWith(2);
    });
  });

  describe('paste', () => {
    it('should distribute pasted digits across the boxes', () => {
      const event = {
        preventDefault: () => {},
        clipboardData: { getData: () => '123456' }
      } as unknown as ClipboardEvent;

      component.onPaste(event);

      expect(component.digits).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(component.value).toBe('123456');
    });

    it('should ignore non-numeric characters when pasting', () => {
      const event = {
        preventDefault: () => {},
        clipboardData: { getData: () => 'a1b2c3' }
      } as unknown as ClipboardEvent;

      component.onPaste(event);

      expect(component.value).toBe('123');
    });

    it('should do nothing when the clipboard has no digits', () => {
      const changedSpy = jest.spyOn(component.changed, 'emit');
      const event = {
        preventDefault: () => {},
        clipboardData: { getData: () => 'abc' }
      } as unknown as ClipboardEvent;

      component.onPaste(event);

      expect(changedSpy).not.toHaveBeenCalled();
    });
  });

  describe('reset', () => {
    it('should clear all digits and focus the first box', () => {
      component.digits = ['1', '2', '3', '4', '5', '6'];
      const spy = jest.spyOn(component as any, 'focusBox');

      component.reset();

      expect(component.digits).toEqual(['', '', '', '', '', '']);
      expect(spy).toHaveBeenCalledWith(0);
    });
  });

  describe('accessibility (NFR-A-01)', () => {
    it('should set a translated aria-label per digit box', () => {
      const labelled = boxes().map(b => b.getAttribute('aria-label'));
      expect(labelled).toEqual([
        'Digit 1 of 6',
        'Digit 2 of 6',
        'Digit 3 of 6',
        'Digit 4 of 6',
        'Digit 5 of 6',
        'Digit 6 of 6',
      ]);
    });

    it('should expose an assertive aria-live region for the error message', () => {
      component.errorMessage = 'Invalid code';
      fixture.detectChanges();

      const liveRegion: HTMLElement = fixture.nativeElement.querySelector('[aria-live="assertive"]');
      expect(liveRegion).toBeTruthy();
      expect(liveRegion.textContent?.trim()).toBe('Invalid code');
    });

    it('should apply the error class to every box when error is true', () => {
      component.error = true;
      fixture.detectChanges();

      boxes().forEach(box => expect(box.classList.contains('error')).toBe(true));
    });
  });
});
