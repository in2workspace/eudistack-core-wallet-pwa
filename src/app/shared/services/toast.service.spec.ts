import { flush, flushMicrotasks, TestBed } from '@angular/core/testing';
import { ToastServiceHandler } from './toast.service';
import { AlertDialogComponent, focusAlertDialog } from '../components/alert-dialog/alert-dialog.component';
import { ModalController } from '@ionic/angular';
import { TranslateService, TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateFakeLoader } from '@ngx-translate/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { SUPPORT_EMAIL, ISSUE_TRACKER_URL, SUPPORT_URL } from 'src/app/core/constants/support.constants';
const TIME_IN_MS = 5000;

// The modal mocks have no DOM: the focus helper is checked in alert-dialog.component.spec.ts.
jest.mock('../components/alert-dialog/alert-dialog.component', () => ({
  ...jest.requireActual('../components/alert-dialog/alert-dialog.component'),
  focusAlertDialog: jest.fn(),
}));

jest.useFakeTimers();

describe('ToastServiceHandler', () => {
  let service: ToastServiceHandler;
  let translateService: {get:jest.Mock, instant:jest.Mock};
  let translateSpy: jest.SpyInstance;
  let modalCtrl: {create:jest.Mock};
  let alert: {present:jest.Mock, dismiss:jest.Mock}
  let supportChannelService: {channels: jest.Mock};

  beforeEach(() => {
    translateService = {
      get: jest.fn().mockImplementation((str:string)=>of(str)),
      instant: jest.fn().mockImplementation((str: string) => str), // Add this mo
    };

    modalCtrl = {
      create: jest.fn().mockResolvedValue({
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockResolvedValue(undefined),
      }),
    };

    supportChannelService = {
      channels: jest.fn().mockReturnValue({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
        supportUrl: SUPPORT_URL,
      }),
    };

    TestBed.configureTestingModule({
      imports: [
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: TranslateFakeLoader }
        }),
      ],
      providers: [
        { provide: TranslateService, useValue:translateService },
        { provide: ModalController, useValue: modalCtrl },
        { provide: SupportChannelService, useValue: supportChannelService },
        ToastServiceHandler
      ],
    });
    service = TestBed.inject(ToastServiceHandler);
    translateSpy = jest.spyOn(translateService, 'get');
  });


  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  // Plain async test, not fakeAsync: this spec file calls jest.useFakeTimers() at
  // module scope, which does not reliably drain a multi-hop mocked-promise chain
  // through zone.js's tick()/flushMicrotasks() — real awaits on the real
  // microtask queue are what actually settles it here.
  it('waits for the alert to be presented and dismissed before the observable emits (regression: map(async ...) used to emit the pending Promise itself and complete immediately)', async () => {
    const order: string[] = [];

    modalCtrl.create.mockResolvedValueOnce({
      present: jest.fn().mockImplementation(async () => { order.push('present'); }),
      dismiss: jest.fn(),
      onDidDismiss: jest.fn().mockImplementation(async () => { order.push('dismiss'); }),
    });

    service.showErrorAlertByTranslateLabel('errors.default')
      .subscribe(() => order.push('next'));

    for (let i = 0; i < 10; i++) { await Promise.resolve(); }

    expect(order).toEqual(['present', 'dismiss', 'next']);
  });

  it('showInfoAlertByTranslateLabel_anyMessage_presentsANoticeWithTheInformativeStyle', async () => {
    // Arrange
    // Act
    service.showInfoAlertByTranslateLabel('errors.session-expired').subscribe();
    for (let i = 0; i < 10; i++) { await Promise.resolve(); }

    // Assert
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining({ cssClass: 'app-alert-modal', componentProps: expect.objectContaining({ variant: 'info' }) }));
  });

  it('showErrorAlertByTranslateLabel_anyMessage_keepsTheErrorStyle', async () => {
    // Arrange
    // Act
    service.showErrorAlertByTranslateLabel('errors.default').subscribe();
    for (let i = 0; i < 10; i++) { await Promise.resolve(); }

    // Assert
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining({ cssClass: 'app-alert-modal', componentProps: expect.objectContaining({ variant: 'error' }) }));
  });

  it('uses the caller-provided fallback key when the message matches no known backend message', fakeAsync(() => {
    service.showErrorAlert('Http failure response for /api/v1/credentials: 500 OK', 'errors.server-error');
    tick();
    expect(translateSpy).toHaveBeenCalledWith('errors.server-error');
    expect(translateSpy).not.toHaveBeenCalledWith('errors.default');
  }));

  it('prefers a known backend message over the fallback key', fakeAsync(() => {
    service.showErrorAlert('Incorrect PIN', 'errors.invalid-request');
    tick();
    expect(translateSpy).toHaveBeenCalledWith('errors.incorrect-pin');
  }));

  it('should format message correctly and translate it', fakeAsync(() => {
    service.showErrorAlert('Any undefined test message');
    tick();
    expect(translateSpy).toHaveBeenCalledWith('errors.default');

    service.showErrorAlert("The received QR content cannot be processed");
    tick();
    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-qr');

    service.showErrorAlert("There are no credentials available to login");
    tick();
    expect(translateSpy).toHaveBeenCalledWith('errors.no-credentials-available');

    service.showErrorAlert('There was a problem processing the QR. It might be invalid or already have been used');
    tick()
    expect(translateSpy).toHaveBeenCalledWith("errors.failed-qr-process");

    service.showErrorAlert("Error while fetching credentialOffer from the issuer");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.expired-credentialOffer");

    service.showErrorAlert("Error while deserializing CredentialOffer");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.invalid-credentialOffer");

    service.showErrorAlert("Error while processing Credential Issuer Metadata from the Issuer");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.invalid-issuerMetadata");

    service.showErrorAlert("Error while fetching  Credential from Issuer");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.cannot-get-VC");

    service.showErrorAlert("Error processing Verifiable Credential");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.cannot-save-VC");

    service.showErrorAlert("Incorrect PIN");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.incorrect-pin");

    service.showErrorAlert("Unsigned");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.unsigned");

    service.showErrorAlert("PIN expired");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.pin-expired");

    service.showErrorAlert("The QR session expired");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.qr-expired");

    service.showErrorAlert("ErrorUnsigned");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.Errunsigned");

    service.showErrorAlert("Credential offer not found");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.expired-credentialOffer");

    service.showErrorAlert("PIN expired");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.pin-expired");

    service.showErrorAlert("The QR session expired");
    tick();
    expect(translateSpy).toHaveBeenCalledWith("errors.qr-expired");
  }));

  it('should create alert for an error message 1', async () => {
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');
    const errorMessage = "The received QR content cannot be processed";

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-qr');
    expect(toastCtrlSpy).toHaveBeenCalled();
    expect(toastCtrlSpy).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.invalid-qr") }),
      }
    ));
    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);

  });

  it('should create alert for an error message 2', async () => {
    const errorMessage = "Error while fetching credentialOffer from the issuer";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.expired-credentialOffer');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.expired-credentialOffer") }),
      }
    ));
    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 3', async () => {
    const errorMessage = "Error while deserializing CredentialOffer";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-credentialOffer');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.invalid-credentialOffer") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 4', async () => {
    const errorMessage = "Error while processing Credential Issuer Metadata from the Issuer";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-issuerMetadata');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.invalid-issuerMetadata") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 5', async () => {
    const errorMessage = "Error while fetching  Credential from Issuer";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.cannot-get-VC');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.cannot-get-VC") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 6', async () => {
    const errorMessage = "Error processing Verifiable Credential";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.cannot-save-VC');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.cannot-save-VC") }),
      }
    ));
    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 7', async () => {
    const errorMessage = "Incorrect PIN";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.incorrect-pin');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.incorrect-pin") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 8', async () => {
    const errorMessage = "Unsigned";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.unsigned');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.unsigned") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  it('should create alert for an error message 9', async () => {
    const errorMessage = "ErrorUnsigned";
    const toastCtrlSpy = jest.spyOn(modalCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.Errunsigned');
    expect(modalCtrl.create).toHaveBeenCalled();
    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        componentProps: expect.objectContaining({ message: expect.stringContaining("errors.Errunsigned") }),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  describe('accessibility of the notices (as the former ion-alert)', () => {
    beforeEach(() => (focusAlertDialog as jest.Mock).mockClear());

    it('an alert leaves the dialog semantics to the notice and focuses it once presented', async () => {
      const modal = {
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn(),
        onDidDismiss: jest.fn().mockResolvedValue(undefined),
      };
      modalCtrl.create.mockResolvedValueOnce(modal);

      service.showErrorAlertByTranslateLabel('errors.default').subscribe();
      for (let i = 0; i < 10; i++) { await Promise.resolve(); }

      expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining({ htmlAttributes: { role: 'none' } }));
      expect(modal.present).toHaveBeenCalled();
      expect(focusAlertDialog).toHaveBeenCalledWith(modal);
    });

    it('a success toast leaves the dialog semantics to the notice and focuses it once presented', fakeAsync(() => {
      service.showToast('toast.success');
      tick();

      expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining({ htmlAttributes: { role: 'none' } }));
      expect(focusAlertDialog).toHaveBeenCalledTimes(1);
      tick(2000);
    }));
  });

  describe('messages as text (EUD-332: no HTML built, innerHTMLTemplatesEnabled off)', () => {
    const propsOf = (spy: jest.SpyInstance) =>
      (spy.mock.calls[0][0] as { componentProps: { message: string; variant: string; closeLabel?: string } }).componentProps;

    it('passes the translated message verbatim, as text, to the notice component', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<img src=x onerror=alert(1)>'));
      const spy = jest.spyOn(modalCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ component: AlertDialogComponent }));
      expect(propsOf(spy).message).toBe('<img src=x onerror=alert(1)>');
    }));

    it('leaves the support link placeholder for the notice component to render', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('Something went wrong. Contact {{supportLink}}.'));
      const spy = jest.spyOn(modalCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(propsOf(spy).message).toBe('Something went wrong. Contact {{supportLink}}.');
      expect(propsOf(spy).closeLabel).toBe('vc-selector.close');
    }));

    it('passes an empty message instead of crashing when the translation is missing', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of(undefined));
      const spy = jest.spyOn(modalCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(propsOf(spy).message).toBe('');
    }));

    it('showToast passes the translated message as text, with the success style and no button', fakeAsync(() => {
      translateService.instant.mockReturnValueOnce('<script>alert(1)</script>');
      const spy = jest.spyOn(modalCtrl, 'create');

      service.showToast('toast.success');
      tick();

      expect(propsOf(spy)).toEqual({ message: '<script>alert(1)</script>', variant: 'success' });
    }));

    it('showInfoToastByTranslateLabel shows markup in the message as text', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<img src=x onerror=alert(1)>'));
      const appendSpy = jest.spyOn(document.body, 'appendChild');

      service.showInfoToastByTranslateLabel('toast.info', 1000, 'info');
      tick();

      const el = appendSpy.mock.calls[appendSpy.mock.calls.length - 1][0] as HTMLElement;
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('span')?.textContent).toBe('<img src=x onerror=alert(1)>');

      tick(1000);
      el.dispatchEvent(new Event('animationend'));
    }));
  });

  it('should create, present, and dismiss a toast after duration', fakeAsync(async () => {
    const duration = 1500;
    const messageKey = 'toast.success';

    const presentMock = jest.fn().mockResolvedValue(undefined);
    const dismissMock = jest.fn().mockResolvedValue(undefined);

    const alertMock = {
      present: presentMock,
      dismiss: dismissMock,
    };

    modalCtrl.create.mockResolvedValueOnce(alertMock as any);

    service.showToast(messageKey, duration);

    tick();

    expect(modalCtrl.create).toHaveBeenCalledWith(expect.objectContaining({
      componentProps: expect.objectContaining({ message: expect.stringContaining(messageKey) }),
      cssClass: 'app-alert-modal',
    }));

    expect(presentMock).toHaveBeenCalled();

    tick(duration);
    expect(dismissMock).toHaveBeenCalled();
  }));

  it('should log instead of leaving an unhandled rejection when the success toast cannot be created', fakeAsync(() => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('overlay unavailable');
    modalCtrl.create.mockRejectedValueOnce(failure);

    service.showToast('toast.success');
    tick();

    expect(consoleSpy).toHaveBeenCalledWith('ToastService: failed to show toast', failure);
    consoleSpy.mockRestore();
  }));

  it('should show info toast and remove it after duration', fakeAsync(() => {
    const appendSpy = jest.spyOn(document.body, 'appendChild');
    const message = 'toast.info';

    service.showInfoToastByTranslateLabel(message, 3000, 'info');
    tick();

    expect(appendSpy).toHaveBeenCalled();
    const el = appendSpy.mock.calls[0][0] as HTMLElement;
    expect(el.className).toContain('credential-toast');
    expect(el.dataset['variant']).toBe('info');
    expect(el.innerHTML).toContain('information-circle');

    // Simulate duration passing
    tick(3000);
    expect(el.classList).toContain('exiting');

    // Simulate animation end
    el.dispatchEvent(new Event('animationend'));
    expect(document.body.contains(el)).toBe(false);
  }));

  it('should pass interpolation params through to the translate service', fakeAsync(() => {
    service.showInfoToastByTranslateLabel('app-update.toast', 5000, 'info', { version: '1.2.3' });
    tick();

    expect(translateSpy).toHaveBeenCalledWith('app-update.toast', { version: '1.2.3' });
  }));

  it('should show warning toast with correct icon', fakeAsync(() => {
    const appendSpy = jest.spyOn(document.body, 'appendChild');

    service.showInfoToastByTranslateLabel('warn.msg', 1000, 'warning');
    tick();

    const el = appendSpy.mock.calls[appendSpy.mock.calls.length - 1][0] as HTMLElement;
    expect(el.dataset['variant']).toBe('warning');
    expect(el.innerHTML).toContain('warning');

    tick(1000);
    el.dispatchEvent(new Event('animationend'));
  }));

});
