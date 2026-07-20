import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule, ModalController } from '@ionic/angular';
import { EventEmitter } from '@angular/core';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ActivityDetailComponent } from './activity-detail.component';
import { ActivityEntry, ActivityType } from 'src/app/core/models/activity.model';

const translateServiceMock = {
  currentLang: 'en',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string) => key,
  get: jest.fn((key: string) => of(key)),
  getBrowserLang: jest.fn().mockReturnValue('en'),
};

const mockModalController = {
  dismiss: jest.fn(),
};

async function createFixture(entry: ActivityEntry): Promise<ComponentFixture<ActivityDetailComponent>> {
  // ActivityDetailComponent's own standalone `imports: [IonicModule, ...]` resolves a fresh
  // ModalController scoped to the component's injector, shadowing a TestBed-level provider
  // override. Overriding the component's own providers ensures the mock wins at the
  // component's element injector (same pattern as activity.page.spec.ts).
  TestBed.overrideComponent(ActivityDetailComponent, {
    add: { providers: [{ provide: ModalController, useValue: mockModalController }] },
  });

  await TestBed.configureTestingModule({
    imports: [ActivityDetailComponent, IonicModule.forRoot(), TranslateModule.forRoot()],
    providers: [
      { provide: ModalController, useValue: mockModalController },
      { provide: TranslateService, useValue: translateServiceMock },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ActivityDetailComponent);
  fixture.componentInstance.entry = entry;
  fixture.detectChanges();
  return fixture;
}

const BASE_TIMESTAMP = new Date('2026-03-05T14:30:00Z').getTime();

describe('ActivityDetailComponent', () => {
  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  // --- Happy paths per type ----------------------------------------------

  it('renders a "presented" entry: title, credential, verifier counterparty, date and fixed result', async () => {
    const entry: ActivityEntry = {
      id: '1',
      type: 'presented',
      credentialName: 'Empleado ACME',
      counterparty: 'https://verifier.example.com/oid4vp',
      timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.type-presented');
    expect(el.textContent).toContain('Empleado ACME');
    expect(el.textContent).toContain('activity.detail-field-counterparty-presented');
    expect(el.textContent).toContain('verifier.example.com');
    expect(el.textContent).toContain('activity.detail-field-result');
    expect(el.textContent).toContain('activity.detail-result-completed');
  });

  it('renders an "issued" entry with the issuer counterparty label', async () => {
    const entry: ActivityEntry = {
      id: '2',
      type: 'issued',
      credentialName: 'Título universitario',
      counterparty: 'https://issuer.example.com',
      timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.type-issued');
    expect(el.textContent).toContain('activity.detail-field-counterparty-issued');
    expect(el.textContent).toContain('issuer.example.com');
  });

  it('renders a "deleted" entry without any counterparty row or shared-attributes section', async () => {
    const entry: ActivityEntry = {
      id: '3',
      type: 'deleted',
      credentialName: 'Certificado antiguo',
      counterparty: 'ACME Issuer',
      timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('Certificado antiguo');
    expect(fixture.componentInstance.showCounterparty).toBe(false);
    expect(el.querySelector('.shared-attributes-section')).toBeFalsy();
  });

  // --- Read-only (AC-04) ---------------------------------------------------

  it('exposes no write actions — only the close button is rendered', async () => {
    const entry: ActivityEntry = {
      id: '4', type: 'presented', credentialName: 'Cred', counterparty: 'https://v.example.com', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    const buttons = Array.from(el.querySelectorAll('ion-button'));
    expect(buttons.length).toBe(1);
    expect(el.querySelector('[name="trash-outline"]')).toBeFalsy();
    expect(el.querySelector('[name="create-outline"]')).toBeFalsy();
  });

  it('close() dismisses the modal without mutating the entry', async () => {
    const entry: ActivityEntry = {
      id: '5', type: 'presented', credentialName: 'Cred', counterparty: 'https://v.example.com', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    fixture.componentInstance.close();

    expect(mockModalController.dismiss).toHaveBeenCalledWith(null, 'close');
  });

  // --- Shared attributes: empty notice (EC-01) ------------------------------

  it('shows the EC-01 empty-attributes notice when a presented entry has no sharedAttributes', async () => {
    const entry: ActivityEntry = {
      id: '6', type: 'presented', credentialName: 'Cred', counterparty: 'https://v.example.com', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.detail-shared-attributes-empty');
    expect(el.querySelector('.shared-attributes-list')).toBeFalsy();
  });

  it('shows the EC-01 empty-attributes notice when sharedAttributes is an empty array', async () => {
    const entry: ActivityEntry = {
      id: '7', type: 'presented', credentialName: 'Cred', counterparty: 'https://v.example.com', timestamp: BASE_TIMESTAMP,
      sharedAttributes: [],
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.detail-shared-attributes-empty');
  });

  // --- Counterparty absent / malformed --------------------------------------

  it('omits the counterparty row when counterparty is an empty string', async () => {
    const entry: ActivityEntry = {
      id: '8', type: 'presented', credentialName: 'Cred', counterparty: '', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);

    expect(fixture.componentInstance.showCounterparty).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('activity.detail-field-counterparty-presented');
  });

  it('falls back to the raw value when counterparty is not a valid URL', async () => {
    const entry: ActivityEntry = {
      id: '9', type: 'issued', credentialName: 'Cred', counterparty: 'ACME Issuer', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);

    expect(fixture.componentInstance.showCounterparty).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('ACME Issuer');
  });

  // --- Many shared attributes (EC-03: natural scroll, no virtual scroll) ---

  it('renders every shared attribute as a plain list item, without any virtual-scroll directive', async () => {
    const manyAttributes = Array.from({ length: 30 }, (_, i) => `claim_${i}`);
    const entry: ActivityEntry = {
      id: '10', type: 'presented', credentialName: 'Cred', counterparty: 'https://v.example.com', timestamp: BASE_TIMESTAMP,
      sharedAttributes: manyAttributes,
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    const items = el.querySelectorAll('.shared-attribute-item');
    expect(items.length).toBe(30);
    expect(items[0].textContent).toContain('claim_0');
    expect(items[29].textContent).toContain('claim_29');
    expect(el.querySelector('cdk-virtual-scroll-viewport')).toBeFalsy();
  });

  // --- Optional fields absent (EC-04) --------------------------------------

  it('omits the details row when entry.details is absent', async () => {
    const entry: ActivityEntry = {
      id: '11', type: 'issued', credentialName: 'Cred', counterparty: 'https://i.example.com', timestamp: BASE_TIMESTAMP,
    };
    const fixture = await createFixture(entry);

    expect(fixture.componentInstance.showDetails).toBe(false);
    expect(fixture.nativeElement.textContent).not.toContain('activity.detail-field-details');
  });

  it('renders the details row when entry.details is present', async () => {
    const entry: ActivityEntry = {
      id: '12', type: 'issued', credentialName: 'Cred', counterparty: 'https://i.example.com', timestamp: BASE_TIMESTAMP,
      details: 'Nota adicional',
    };
    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(fixture.componentInstance.showDetails).toBe(true);
    expect(el.textContent).toContain('activity.detail-field-details');
    expect(el.textContent).toContain('Nota adicional');
  });

  it('omits the shared-attributes section for a non-"presented" type even with sharedAttributes set', async () => {
    const entry: ActivityEntry = {
      id: '13', type: 'issued', credentialName: 'Cred', counterparty: 'https://i.example.com', timestamp: BASE_TIMESTAMP,
      sharedAttributes: ['given_name'],
    };
    const fixture = await createFixture(entry);

    expect(fixture.componentInstance.showSharedAttributes).toBe(false);
    expect(fixture.nativeElement.querySelector('.shared-attributes-section')).toBeFalsy();
  });

  // --- Unknown type (ES-01) -------------------------------------------------

  it('falls back to the generic type label and hides counterparty/attributes for an unknown type', async () => {
    const entry = {
      id: '14', type: 'unknown' as unknown as ActivityType, credentialName: 'Cred', counterparty: 'https://x.example.com', timestamp: BASE_TIMESTAMP,
    } as ActivityEntry;

    const fixture = await createFixture(entry);
    const el: HTMLElement = fixture.nativeElement;

    expect(fixture.componentInstance.typeLabelKey).toBe('activity.type-unknown');
    expect(el.textContent).toContain('activity.type-unknown');
    expect(fixture.componentInstance.showCounterparty).toBe(false);
    expect(fixture.componentInstance.showSharedAttributes).toBe(false);
  });

  it('does not throw when type is undefined', async () => {
    const entry = {
      id: '15', credentialName: 'Cred', counterparty: '', timestamp: BASE_TIMESTAMP,
    } as unknown as ActivityEntry;

    await expect(createFixture(entry)).resolves.toBeTruthy();
  });
});
