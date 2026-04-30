import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { AlertController, IonicModule } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { IosInstallOnboardingPage } from './ios-install-onboarding.page';
import { IosInstallService } from 'src/app/shared/services/ios-install.service';
import { PasskeyStoreService } from 'src/app/core/services/passkey-store.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';

function buildRoute(state: string | null) {
  return { snapshot: { queryParamMap: { get: () => state } } };
}

describe('IosInstallOnboardingPage', () => {
  let fixture: ComponentFixture<IosInstallOnboardingPage>;
  let component: IosInstallOnboardingPage;

  let iosInstall: { wizardState: jest.Mock; isDismissed: jest.Mock; dismissOnboarding: jest.Mock };
  let passkeyStore: { hasPasskey: jest.Mock };
  let telemetry: { track: jest.Mock };
  let alertController: { create: jest.Mock };
  let router: { navigateByUrl: jest.Mock };

  beforeEach(async () => {
    iosInstall = { wizardState: jest.fn(), isDismissed: jest.fn(), dismissOnboarding: jest.fn() };
    passkeyStore = { hasPasskey: jest.fn().mockReturnValue(false) };
    telemetry = { track: jest.fn() };
    alertController = { create: jest.fn() };
    router = { navigateByUrl: jest.fn() };

    iosInstall.wizardState.mockReturnValue('not-bootstrapped');

    await TestBed.configureTestingModule({
      imports: [IosInstallOnboardingPage, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [
        { provide: IosInstallService, useValue: iosInstall },
        { provide: PasskeyStoreService, useValue: passkeyStore },
        { provide: TelemetryService, useValue: telemetry },
        { provide: AlertController, useValue: alertController },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: buildRoute('not-bootstrapped') },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(IosInstallOnboardingPage);
    component = fixture.componentInstance;
  });

  it('creates the component', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('reads state from query params on init', () => {
    fixture.detectChanges();
    expect(component.state).toBe('not-bootstrapped');
  });

  it('fires ios_onboarding_shown telemetry on init — AC-008.10', () => {
    fixture.detectChanges();
    expect(telemetry.track).toHaveBeenCalledWith('ios_onboarding_shown', { state: 'not-bootstrapped' });
  });

  it('exposes 5 wizard steps', () => {
    expect(component.steps.length).toBe(5);
  });

  it('reads already-bootstrapped state from query params', () => {
    // Swap the route snapshot before init — no TestBed reconfiguration needed
    const altRoute = buildRoute('already-bootstrapped');
    (component as any).route = altRoute;
    component.ngOnInit();
    expect(component.state).toBe('already-bootstrapped');
  });

  describe('openLearnMore (AC-008.4)', () => {
    it('presents an alert', fakeAsync(async () => {
      const learnAlert = { present: jest.fn().mockResolvedValue(undefined) };
      alertController.create.mockResolvedValue(learnAlert);
      fixture.detectChanges();

      component.openLearnMore();
      tick();
      await Promise.resolve();

      expect(alertController.create).toHaveBeenCalled();
      expect(learnAlert.present).toHaveBeenCalled();
    }));
  });

  describe('continueAnyway (AC-008.7)', () => {
    it('calls dismissOnboarding and tracks telemetry when user confirms', fakeAsync(() => {
      fixture.detectChanges();

      alertController.create.mockImplementation((opts: any) => {
        const confirmBtn = (opts.buttons as any[]).find(b => b.role === 'confirm');
        confirmBtn?.handler?.();
        return Promise.resolve({ present: jest.fn() });
      });

      component.continueAnyway();
      tick();

      expect(iosInstall.dismissOnboarding).toHaveBeenCalled();
      expect(telemetry.track).toHaveBeenCalledWith('ios_onboarding_dismissed', { state: 'not-bootstrapped' });
    }));

    it('navigates to /auth/register when no passkey on confirm', fakeAsync(() => {
      passkeyStore.hasPasskey.mockReturnValue(false);
      fixture.detectChanges();

      alertController.create.mockImplementation((opts: any) => {
        const confirmBtn = (opts.buttons as any[]).find(b => b.role === 'confirm');
        confirmBtn?.handler?.();
        return Promise.resolve({ present: jest.fn() });
      });

      component.continueAnyway();
      tick();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/register');
    }));

    it('navigates to /auth/login when passkey exists on confirm', fakeAsync(() => {
      passkeyStore.hasPasskey.mockReturnValue(true);
      fixture.detectChanges();

      alertController.create.mockImplementation((opts: any) => {
        const confirmBtn = (opts.buttons as any[]).find(b => b.role === 'confirm');
        confirmBtn?.handler?.();
        return Promise.resolve({ present: jest.fn() });
      });

      component.continueAnyway();
      tick();

      expect(router.navigateByUrl).toHaveBeenCalledWith('/auth/login');
    }));
  });
});
