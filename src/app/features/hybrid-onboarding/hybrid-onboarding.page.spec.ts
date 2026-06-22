import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { AlertController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { HybridOnboardingPage } from './hybrid-onboarding.page';
import { HybridAuditService } from 'src/app/core/services/hybrid-audit.service';
import { HybridOnboardingService } from 'src/app/core/services/hybrid-onboarding.service';
import { TelemetryService } from 'src/app/core/services/telemetry.service';

describe('HybridOnboardingPage', () => {
  let fixture: ComponentFixture<HybridOnboardingPage>;
  let component: HybridOnboardingPage;
  let router: { navigateByUrl: jest.Mock };
  let hybridOnboarding: { markAccepted: jest.Mock; isAccepted: jest.Mock };
  let hybridAudit: { recordConstraintAccepted: jest.Mock };
  let telemetry: { track: jest.Mock };
  let alertController: { create: jest.Mock };

  beforeEach(async () => {
    router = { navigateByUrl: jest.fn() };
    hybridOnboarding = { markAccepted: jest.fn(), isAccepted: jest.fn() };
    hybridAudit = { recordConstraintAccepted: jest.fn().mockReturnValue(of(undefined)) };
    telemetry = { track: jest.fn() };
    alertController = { create: jest.fn().mockResolvedValue({ present: jest.fn() }) };

    await TestBed.configureTestingModule({
      imports: [HybridOnboardingPage, TranslateModule.forRoot()],
      providers: [
        { provide: Router, useValue: router },
        { provide: HybridOnboardingService, useValue: hybridOnboarding },
        { provide: HybridAuditService, useValue: hybridAudit },
        { provide: TelemetryService, useValue: telemetry },
        { provide: AlertController, useValue: alertController },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HybridOnboardingPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('tracks shown event on init', () => {
    expect(telemetry.track).toHaveBeenCalledWith('hybrid_onboarding_shown');
  });

  it('marks accepted, calls audit, tracks and navigates on accept()', () => {
    component.accept();

    expect(hybridOnboarding.markAccepted).toHaveBeenCalled();
    expect(hybridAudit.recordConstraintAccepted).toHaveBeenCalled();
    expect(telemetry.track).toHaveBeenCalledWith('hybrid_onboarding_accepted');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs');
  });

  it('still navigates when audit call fails', () => {
    hybridAudit.recordConstraintAccepted.mockReturnValue(throwError(() => new Error('network')));

    component.accept();

    expect(hybridOnboarding.markAccepted).toHaveBeenCalled();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/tabs');
  });
});
