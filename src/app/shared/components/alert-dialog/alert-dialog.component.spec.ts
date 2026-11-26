import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateFakeLoader, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { ISSUE_TRACKER_URL, SUPPORT_EMAIL, SUPPORT_URL } from 'src/app/core/constants/support.constants';
import { AlertDialogComponent, AlertDialogVariant, focusAlertDialog } from './alert-dialog.component';

describe('AlertDialogComponent', () => {
  let fixture: ComponentFixture<AlertDialogComponent>;
  let modalController: { dismiss: jest.Mock };

  const render = (inputs: { message?: string; variant?: AlertDialogVariant; closeLabel?: string }): HTMLElement => {
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  beforeEach(() => {
    modalController = { dismiss: jest.fn().mockResolvedValue(true) };

    // The component's own `imports: [IonicModule]` resolves a fresh ModalController in its
    // injector; a component-level provider makes the mock win (same as about.page.spec.ts).
    TestBed.overrideComponent(AlertDialogComponent, {
      add: { providers: [{ provide: ModalController, useValue: modalController }] },
    });

    TestBed.configureTestingModule({
      imports: [
        AlertDialogComponent,
        IonicModule.forRoot(),
        TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: TranslateFakeLoader } }),
      ],
      providers: [
        { provide: ModalController, useValue: modalController },
        {
          provide: SupportChannelService,
          useValue: {
            channels: () => ({
              email: SUPPORT_EMAIL,
              helpCenterUrl: null,
              issueTrackerUrl: ISSUE_TRACKER_URL,
              supportUrl: SUPPORT_URL,
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AlertDialogComponent);
  });

  it.each<AlertDialogVariant>(['error', 'info', 'success'])('applies the %s style', variant => {
    const el = render({ message: 'msg', variant });

    expect(el.querySelector('.alert-dialog')?.classList).toContain(`alert-dialog--${variant}`);
  });

  it('shows the success icon only for the success variant', () => {
    expect(render({ message: 'done', variant: 'success' }).querySelector('ion-icon')?.getAttribute('name'))
      .toBe('checkmark-circle');
    expect(render({ variant: 'error' }).querySelector('ion-icon')).toBeNull();
  });

  it('renders the message as text, with the support link', () => {
    const el = render({ message: '<b>Error</b>. Contact {{supportLink}}.', variant: 'error' });

    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<b>Error</b>. Contact');
    expect(el.querySelector('a')?.getAttribute('href')).toBe(SUPPORT_URL);
  });

  it('closes the modal with the ok role from its button', () => {
    const el = render({ message: 'msg', closeLabel: 'Close' });

    const button = el.querySelector('button') as HTMLButtonElement;
    expect(button.textContent).toBe('Close');
    button.click();

    expect(modalController.dismiss).toHaveBeenCalledWith(undefined, 'ok');
  });

  it('has no button without a close label (auto-dismissed notices)', () => {
    const el = render({ message: 'msg', variant: 'success' });

    expect(el.querySelector('button')).toBeNull();
  });

  describe('accessibility (as the former ion-alert)', () => {
    it('with a button, is a modal alertdialog described by its message', () => {
      const el = render({ message: 'Something failed', variant: 'error', closeLabel: 'Close' });
      const dialog = el.querySelector('.alert-dialog') as HTMLElement;

      expect(dialog.getAttribute('role')).toBe('alertdialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      const description = el.querySelector(`#${dialog.getAttribute('aria-describedby')}`);
      expect(description?.textContent).toContain('Something failed');
    });

    it('without a button, is an alert', () => {
      const dialog = render({ message: 'Done', variant: 'success' }).querySelector('.alert-dialog') as HTMLElement;

      expect(dialog.getAttribute('role')).toBe('alert');
      expect(dialog.hasAttribute('aria-modal')).toBe(false);
      expect(dialog.hasAttribute('aria-describedby')).toBe(false);
    });

    it('focusAlertDialog focuses the button when there is one', () => {
      const el = render({ message: 'msg', closeLabel: 'Close' });
      document.body.appendChild(el);

      focusAlertDialog(el);

      expect(document.activeElement).toBe(el.querySelector('button'));
      el.remove();
    });

    it('focusAlertDialog focuses the notice itself when it has no button', () => {
      const el = render({ message: 'msg', variant: 'success' });
      document.body.appendChild(el);

      focusAlertDialog(el);

      expect(document.activeElement).toBe(el.querySelector('.alert-dialog'));
      el.remove();
    });
  });
});
