import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { Router } from '@angular/router';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RegisterDevicePage } from './register-device.page';
import { RemoteAuthService } from 'src/app/core/services/auth.service';
import { WalletInstanceService } from 'src/app/core/services/wallet-instance.service';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';

const translate = {
  currentLang: 'es',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string) => (key === 'device-registration.installed-app' ? 'App instalada' : key),
  get: (key: string) => of(key === 'device-registration.installed-app' ? 'App instalada' : key),
  stream: (key: string) => of(key),
  getBrowserLang: () => 'es',
};

describe('RegisterDevicePage (EUD-15 "Registrar este dispositivo")', () => {
  let fixture: ComponentFixture<RegisterDevicePage>;
  let page: RegisterDevicePage;
  let auth: { accountId: jest.Mock; deviceRegistered: jest.Mock };
  let instances: { register: jest.Mock };
  let router: { navigateByUrl: jest.Mock };

  beforeEach(async () => {
    sessionStorage.clear();
    auth = { accountId: jest.fn().mockReturnValue('sub-1'), deviceRegistered: jest.fn().mockResolvedValue(undefined) };
    instances = { register: jest.fn().mockResolvedValue({ id: 'wi-1' }) };
    router = { navigateByUrl: jest.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      schemas: [NO_ERRORS_SCHEMA],
      imports: [RegisterDevicePage, TranslateModule.forRoot()],
      providers: [
        { provide: TranslateService, useValue: translate },
        { provide: RemoteAuthService, useValue: auth },
        { provide: WalletInstanceService, useValue: instances },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RegisterDevicePage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('proposes a name with the equipment and the browser, which the user can change (AC-01)', () => {
    const name = page.form.controls.name.value;
    expect(name).toMatch(/ · /);
    expect(page.canContinue()).toBe(true);
    expect(page.length()).toBe([...name].length);
    expect(name).not.toContain('device-registration');
  });

  it('cannot continue with an empty name or one longer than 50 characters (AC-02)', () => {
    page.form.controls.name.setValue('   ');
    expect(page.canContinue()).toBe(false);

    page.form.controls.name.setValue('x'.repeat(51));
    expect(page.canContinue()).toBe(false);

    page.form.controls.name.setValue('x'.repeat(50));
    expect(page.canContinue()).toBe(true);
  });

  it('registers the device with the chosen name, loads the session and resumes the saved offer (AC-07, AC-09)', async () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?credential_offer_uri=x');
    page.form.controls.name.setValue('Mi iPhone');

    await page.register();

    expect(instances.register).toHaveBeenCalledWith('sub-1', 'Mi iPhone', expect.stringMatching(/mobile|tablet|desktop/));
    expect(auth.deviceRegistered).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials?credential_offer_uri=x', { replaceUrl: true });
  });

  it('goes to the wallet without a saved offer', async () => {
    await page.register();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials', { replaceUrl: true });
  });

  it('shows the error and Retry when the registration fails, and stays (wireframes)', async () => {
    instances.register.mockRejectedValue(new Error('down'));

    await page.register();
    fixture.detectChanges();

    expect(page.failed()).toBe(true);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(auth.deviceRegistered).not.toHaveBeenCalled();
    const content = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(content).toContain('device-registration.failed');
    expect(content).toContain('device-registration.retry');
  });

  it('without a session goes to the access screen', async () => {
    auth.accountId.mockReturnValue(null);

    await page.register();

    expect(instances.register).not.toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/access', { replaceUrl: true });
  });
});
