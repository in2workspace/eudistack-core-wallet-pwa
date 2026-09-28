import { flush, flushMicrotasks, TestBed } from '@angular/core/testing';
import { ToastServiceHandler } from './toast.service';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateService, TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { TranslateFakeLoader } from '@ngx-translate/core';
import { fakeAsync, tick } from '@angular/core/testing';
import { of } from 'rxjs';
import { DomSanitizer } from '@angular/platform-browser';
import { SupportChannelService } from 'src/app/core/services/support-channel.service';
import { SUPPORT_EMAIL, ISSUE_TRACKER_URL, SUPPORT_URL } from 'src/app/core/constants/support.constants';
const TIME_IN_MS = 5000;

jest.useFakeTimers();

describe('ToastServiceHandler', () => {
  let service: ToastServiceHandler;
  let translateService: {get:jest.Mock, instant:jest.Mock};
  let translateSpy: jest.SpyInstance;
  let alertCtrl: {create:jest.Mock};
  let alert: {present:jest.Mock, dismiss:jest.Mock}
  let supportChannelService: {channels: jest.Mock};

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
        { provide: AlertController, useValue: alertCtrl },
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

  describe('HTML sanitization of translated text (security-auditor full-mode review, EUD-142 F2)', () => {
    const messageOf = (spy: jest.SpyInstance) => (spy.mock.calls[0][0] as { message: string }).message;

    it('showErrorAlertByTranslateLabel strips event handlers from the translated message', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<img src=x onerror=alert(1)>'));
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(messageOf(spy)).not.toContain('onerror');
    }));

    it('showErrorAlertByTranslateLabel drops script tags from the translated message', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of('<script>alert(1)</script>ok'));
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(messageOf(spy)).not.toContain('<script');
      expect(messageOf(spy)).toContain('ok');
    }));

    it('showErrorAlertByTranslateLabel neutralises javascript: hrefs', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of("<a href='javascript:alert(1)'>x</a>"));
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(messageOf(spy)).toContain('unsafe:javascript:alert(1)');
    }));

    it('keeps the support link authored in the translation catalogue', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() =>
        of("Algo ha salido mal. Contacta con el <a href='https://support.example/' target='_blank' rel='noopener noreferrer'>equipo de soporte</a>."));
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      const message = messageOf(spy);
      expect(message).toContain('href="https://support.example/"');
      expect(message).toContain('target="_blank"');
      expect(message).toContain('>equipo de soporte</a>');
      expect(message).not.toContain('&lt;a');
    }));

    it('renders an empty message instead of crashing when the translation is missing', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() => of(undefined));
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(messageOf(spy)).toContain('<span></span>');
    }));

    it('falls back to an empty message when the sanitizer rejects the content outright', fakeAsync(() => {
      jest.spyOn(TestBed.inject(DomSanitizer), 'sanitize').mockReturnValue(null);
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      expect(messageOf(spy)).toContain('<span></span>');
    }));

    it('showToast drops script tags from the translated message', fakeAsync(() => {
      translateService.instant.mockReturnValueOnce('<script>alert(1)</script>');
      const spy = jest.spyOn(alertCtrl, 'create');

      service.showToast('toast.success');
      tick();

      expect(messageOf(spy)).not.toContain('<script');
    }));
  });

  describe('support link placeholder (errors.default, pin-expired, etc.)', () => {
    it('replaces {{supportLink}} with a code-built anchor pointing at the default support URL', fakeAsync(() => {
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
        `<a href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer">the support team</a>`
      );
      expect(message).not.toContain('{{supportLink}}');
    }));

    it('points the support link at the tenant-resolved support URL when the theme overrides it', fakeAsync(() => {
      supportChannelService.channels.mockReturnValue({
        email: SUPPORT_EMAIL,
        helpCenterUrl: null,
        issueTrackerUrl: ISSUE_TRACKER_URL,
        supportUrl: 'https://ticketing.customer.example/',
      });
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
        '<a href="https://ticketing.customer.example/" target="_blank" rel="noopener noreferrer">the support team</a>'
      );
    }));

    it('sanitizes dangerous markup surrounding the placeholder while still inserting the support link', fakeAsync(() => {
      translateService.get.mockImplementationOnce(() =>
        of('<script>alert(1)</script>Something went wrong. Contact {{supportLink}}.'));
      translateService.instant.mockImplementation((key: string) =>
        key === 'errors.support-team-label' ? 'the support team' : key
      );
      const toastCtrlSpy = jest.spyOn(alertCtrl, 'create');

      service.showErrorAlertByTranslateLabel('errors.default').subscribe(() => {});
      tick();

      const [call] = toastCtrlSpy.mock.calls;
      const message = (call[0] as { message: string }).message;
      expect(message).not.toContain('<script');
      expect(message).toContain(
        `<a href="${SUPPORT_URL}" target="_blank" rel="noopener noreferrer">the support team</a>`
      );
      expect(message).not.toContain('{{supportLink}}');
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
