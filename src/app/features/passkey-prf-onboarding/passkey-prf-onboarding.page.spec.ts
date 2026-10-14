import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { PasskeyPrfOnboardingPage } from './passkey-prf-onboarding.page';
import { PENDING_DEEP_LINK_KEY } from 'src/app/core/constants/deep-link.constants';
import { PasskeyPrfAuditService } from 'src/app/core/services/passkey-prf-audit.service';
import { PasskeyPrfOnboardingService } from 'src/app/core/services/passkey-prf-onboarding.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';

describe('PasskeyPrfOnboardingPage', () => {
  let fixture: ComponentFixture<PasskeyPrfOnboardingPage>;
  let component: PasskeyPrfOnboardingPage;
  let router: { navigateByUrl: jest.Mock };
  let passkeyPrfOnboarding: { markAccepted: jest.Mock; isAccepted: jest.Mock };
  let passkeyPrfAudit: { recordConstraintAccepted: jest.Mock };
  let telemetry: { track: jest.Mock };
  let alertController: { create: jest.Mock };

  beforeEach(async () => {
    sessionStorage.clear();
    router = { navigateByUrl: jest.fn() };
    passkeyPrfOnboarding = { markAccepted: jest.fn(), isAccepted: jest.fn() };
    passkeyPrfAudit = { recordConstraintAccepted: jest.fn().mockReturnValue(of(undefined)) };
    telemetry = { track: jest.fn() };
    alertController = { create: jest.fn().mockResolvedValue({ present: jest.fn() }) };

    await TestBed.configureTestingModule({
      imports: [PasskeyPrfOnboardingPage, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: PasskeyPrfOnboardingService, useValue: passkeyPrfOnboarding },
        { provide: PasskeyPrfAuditService, useValue: passkeyPrfAudit },
        { provide: TelemetryService, useValue: telemetry },
        { provide: AlertController, useValue: alertController },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PasskeyPrfOnboardingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('tracks shown event on init', () => {
    expect(telemetry.track).toHaveBeenCalledWith('passkey_prf_onboarding_shown');
  });

  it('marks accepted, tracks, navigates immediately and fires audit in background', () => {
    component.accept();

    expect(passkeyPrfOnboarding.markAccepted).toHaveBeenCalled();
    expect(telemetry.track).toHaveBeenCalledWith('passkey_prf_onboarding_accepted');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs');
    expect(passkeyPrfAudit.recordConstraintAccepted).toHaveBeenCalled();
  });

  it('resumes the pending deep link instead of /tabs after accepting', () => {
    sessionStorage.setItem(PENDING_DEEP_LINK_KEY, '/tabs/credentials?credentialOfferUri=abc');

    component.accept();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs/credentials?credentialOfferUri=abc');
    expect(sessionStorage.getItem(PENDING_DEEP_LINK_KEY)).toBeNull();
  });

  it('navigates even when audit call fails', () => {
    passkeyPrfAudit.recordConstraintAccepted.mockReturnValue(throwError(() => new Error('network')));

    component.accept();

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs');
  });
});
