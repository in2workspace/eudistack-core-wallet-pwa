import { flush, flushMicrotasks, TestBed } from '@angular/core/testing';
import { ToastServiceHandler } from './toast.service';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateService, TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateFakeLoader } from '@ngx-translate/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
const TIME_IN_MS = 5000;

jest.useFakeTimers();

describe('ToastServiceHandler', () => {
  let service: ToastServiceHandler;
  let translateService: {get:jest.Mock, instant:jest.Mock};
  let translateSpy: jest.SpyInstance;
  let alertCtrl: {create:jest.Mock};
  let alert: {present:jest.Mock, dismiss:jest.Mock}

  beforeEach(() => {
    translateService = {
      get: jest.fn().mockImplementation((str:string)=>of(str)),
      instant: jest.fn().mockImplementation((str: string) => str), // Add this mo
    };

    alertCtrl = {
      create: jest.fn().mockResolvedValue({
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockResolvedValue(undefined),
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
        { provide: AlertController, useValue: alertCtrl },
        ToastServiceHandler
      ],
    });
    service = TestBed.inject(ToastServiceHandler);
    translateSpy = jest.spyOn(translateService, 'get');
  });


  it('should be created', () => {
    expect(service).toBeTruthy();
  });

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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');
    const errorMessage = "The received QR content cannot be processed";

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-qr');
    expect(toastCtrlSpy).toHaveBeenCalled();
    expect(toastCtrlSpy).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.invalid-qr"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.expired-credentialOffer');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.expired-credentialOffer"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-credentialOffer');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.invalid-credentialOffer"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.invalid-issuerMetadata');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.invalid-issuerMetadata"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.cannot-get-VC');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.cannot-get-VC"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.cannot-save-VC');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.cannot-save-VC"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.incorrect-pin');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.incorrect-pin"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.unsigned');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.unsigned"),
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
    const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

    service.showErrorAlert(errorMessage).subscribe(()=>{});

    expect(translateSpy).toHaveBeenCalledWith('errors.Errunsigned');
    expect(alertCtrl.create).toHaveBeenCalled();
    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining(
      {
        message: expect.stringContaining("errors.Errunsigned"),
      }
    ));

    const toast = await toastCtrlSpy.mock.results[0].value;

    expect(toast.present).toHaveBeenCalled();
    setTimeout(() => {
      expect(toast.dismiss).toHaveBeenCalled()
    }, TIME_IN_MS);
  });

  describe('HTML escaping of translated text (security-auditor full-mode review, EUD-142 F2)', () => {
    it('showErrorAlertByTranslateLabel escapes markup in the translated message before it reaches alertController', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<img src=x onerror=alert(1)>'));
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(toastCtrlSpy).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('&lt;img src=x onerror=alert(1)&gt;'),
      }));
      const [call] = toastCtrlSpy.mock.calls;
      expect((call[0] as { message: string }).message).not.toContain('<img');
    }));

    it('showToast escapes markup in the translated message before it reaches alertController', fakeAsync(() => {
      translateService.instant.mockReturnValueOnce('<script>alert(1)</script>');
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showToast('toast.success');
      tick();

      const [call] = toastCtrlSpy.mock.calls;
      expect((call[0] as { message: string }).message).not.toContain('<script>');
      expect((call[0] as { message: string }).message).toContain('&lt;script&gt;');
    }));
  });

  describe('support link placeholder (errors.default, pin-expired, etc.)', () => {
    it('replaces {{supportLink}} with a code-built anchor pointing at the fixed support URL', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('Something went wrong. Contact {{supportLink}}.'));
      translateService.instant.mockImplementation((key: string) =>
        key === 'errors.support-team-label' ? 'the support team' : key
      );
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      const [call] = toastCtrlSpy.mock.calls;
      const message = (call[0] as { message: string }).message;
      expect(message).toContain(
        "<a href=\"https://ticketing.dome-marketplace.eu/\" target=\"_blank\" rel=\"noopener noreferrer\">the support team</a>"
      );
      expect(message).not.toContain('{{supportLink}}');
    }));

    it('still escapes markup surrounding the placeholder, and escapes the link label too', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<b>Alert</b> contact {{supportLink}}.'));
      translateService.instant.mockImplementation((key: string) =>
        key === 'errors.support-team-label' ? '<i>support</i>' : key
      );
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      const [call] = toastCtrlSpy.mock.calls;
      const message = (call[0] as { message: string }).message;
      expect(message).toContain('&lt;b&gt;Alert&lt;/b&gt;');
      expect(message).toContain('&lt;i&gt;support&lt;/i&gt;');
      expect(message).not.toContain('<b>Alert</b>');
      expect(message).not.toContain('<i>support</i>');
    }));

    it('leaves messages without the placeholder untouched (no stray link)', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('Plain message, no link needed.'));
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.qr-expired').subscribe(() => {});
      tick();

      const [call] = toastCtrlSpy.mock.calls;
      const message = (call[0] as { message: string }).message;
      expect(message).toContain('Plain message, no link needed.');
      expect(message).not.toContain('<a href');
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

    alertCtrl.create.mockResolvedValueOnce(alertMock as any);

    service.showToast(messageKey, duration);

    tick();

    expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining(messageKey),
      cssClass: 'custom-alert-ok',
    }));

    expect(presentMock).toHaveBeenCalled();

    tick(duration);
    expect(dismissMock).toHaveBeenCalled();
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

  describe('showSessionExpiryWarning', () => {
    it('presents an alert with the translated message, only the confirm button, and no backdrop dismissal', async () => {
      const onContinue = jest.fn();

      const alertRef = await service.showSessionExpiryWarning(onContinue);

      expect(alertCtrl.create).toHaveBeenCalledWith(expect.objectContaining({
        message: expect.stringContaining('errors.session-warning-message'),
        buttons: [
          expect.objectContaining({ text: 'errors.session-warning-continue', role: 'confirm' }),
        ],
        backdropDismiss: false,
      }));
      expect(alertRef.present).toHaveBeenCalled();
    });

    it('invokes onContinue when the confirm button handler runs', async () => {
      const onContinue = jest.fn();

      await service.showSessionExpiryWarning(onContinue);

      const [createArgs] = alertCtrl.create.mock.calls[alertCtrl.create.mock.calls.length - 1];
      const confirmButton = createArgs.buttons.find((b: { role: string }) => b.role === 'confirm');
      confirmButton.handler();

      expect(onContinue).toHaveBeenCalled();
    });

    it('starts the countdown bar at 100% width', async () => {
      await service.showSessionExpiryWarning(jest.fn());

      const [createArgs] = alertCtrl.create.mock.calls[alertCtrl.create.mock.calls.length - 1];
      expect(extractBarWidth(createArgs.message)).toBe(100);
    });

    it('shrinks the bar and updates the remaining-time text once per second', async () => {
      const neverDismissed = new Promise<void>(() => { /* not dismissed during this test */ });
      const alertMock = {
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockReturnValue(neverDismissed),
        message: '',
      };
      alertCtrl.create.mockResolvedValueOnce(alertMock);

      // Invoking the captured setInterval callback directly, rather than
      // advancing a fake clock, sidesteps a known bad interaction in this
      // file between the module-level jest.useFakeTimers() and Angular's
      // zone-based fakeAsync/tick() — the two virtual clocks don't drive
      // each other's setInterval callbacks reliably.
      let tickCallback: (() => void) | undefined;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')
        .mockImplementation((fn: TimerHandler) => { tickCallback = fn as () => void; return 0 as unknown as ReturnType<typeof setInterval>; });

      await service.showSessionExpiryWarning(jest.fn());
      expect(tickCallback).toBeDefined();

      tickCallback!();
      expect(extractBarWidth(alertMock.message)).toBeCloseTo((59 / 60) * 100);

      for (let i = 0; i < 29; i++) {
        tickCallback!();
      }
      expect(extractBarWidth(alertMock.message)).toBeCloseTo(50);

      setIntervalSpy.mockRestore();
    });

    it('clears the interval on its own once the countdown reaches zero, without waiting for dismiss', async () => {
      const neverDismissed = new Promise<void>(() => { /* not dismissed during this test */ });
      const fakeIntervalId = 7 as unknown as ReturnType<typeof setInterval>;
      const alertMock = {
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockReturnValue(neverDismissed),
        message: '',
      };
      alertCtrl.create.mockResolvedValueOnce(alertMock);

      let tickCallback: (() => void) | undefined;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')
        .mockImplementation((fn: TimerHandler) => { tickCallback = fn as () => void; return fakeIntervalId; });
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

      await service.showSessionExpiryWarning(jest.fn());

      for (let i = 0; i < 60; i++) {
        tickCallback!();
      }

      expect(extractBarWidth(alertMock.message)).toBe(0);
      expect(clearIntervalSpy).toHaveBeenCalledWith(fakeIntervalId);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it('stops ticking once the alert is dismissed', async () => {
      let resolveDismiss!: () => void;
      const dismissed = new Promise<void>((resolve) => { resolveDismiss = resolve; });
      const alertMock = {
        present: jest.fn().mockResolvedValue(undefined),
        dismiss: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockReturnValue(dismissed),
        message: '',
      };
      alertCtrl.create.mockResolvedValueOnce(alertMock);

      let tickCallback: (() => void) | undefined;
      const fakeIntervalId = 42 as unknown as ReturnType<typeof setInterval>;
      const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')
        .mockImplementation((fn: TimerHandler) => { tickCallback = fn as () => void; return fakeIntervalId; });
      const clearIntervalSpy = jest.spyOn(globalThis, 'clearInterval');

      await service.showSessionExpiryWarning(jest.fn());
      tickCallback!();
      tickCallback!();
      const messageAtDismiss = alertMock.message;
      expect(messageAtDismiss).not.toBe('');

      resolveDismiss();
      await Promise.resolve();
      await Promise.resolve();

      expect(clearIntervalSpy).toHaveBeenCalledWith(fakeIntervalId);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });
});

function extractBarWidth(message: string): number {
  const match = message.match(/width:\s*([\d.]+)%/);
  if (!match) {
    throw new Error(`No countdown bar width found in message: ${message}`);
  }
  return Number(match[1]);
}
