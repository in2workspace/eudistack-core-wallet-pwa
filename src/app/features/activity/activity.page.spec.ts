import { TestBed, ComponentFixture } from '@angular/core/testing';
import { IonicModule, AlertController } from '@ionic/angular';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { EventEmitter, NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';
import { ActivityPage } from './activity.page';
import { ActivityService } from 'src/app/core/services/activity.service';
import { ActivityEntry } from 'src/app/core/models/activity.model';

const translateServiceMock = {
  currentLang: 'en',
  onLangChange: new EventEmitter<LangChangeEvent>(),
  onTranslationChange: new EventEmitter(),
  onDefaultLangChange: new EventEmitter(),
  use: jest.fn(),
  instant: (key: string) => key,
  get: (key: string) => of(key),
  getBrowserLang: jest.fn().mockReturnValue('en'),
};

const mockActivityService = {
  findAll: jest.fn().mockResolvedValue([]),
  clear: jest.fn().mockResolvedValue(undefined),
};

const mockAlertController = {
  create: jest.fn(),
};

async function createFixture(): Promise<ComponentFixture<ActivityPage>> {
  await TestBed.configureTestingModule({
    schemas: [NO_ERRORS_SCHEMA],
    imports: [ActivityPage, IonicModule.forRoot(), TranslateModule.forRoot()],
    providers: [
      { provide: ActivityService, useValue: mockActivityService },
      { provide: AlertController, useValue: mockAlertController },
      { provide: TranslateService, useValue: translateServiceMock },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ActivityPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

const PRESENTED_ENTRY: ActivityEntry = {
  id: '1',
  type: 'presented',
  credentialName: 'Empleado ACME',
  counterparty: 'https://verifier.portal.example/oid4vp',
  timestamp: Date.now() - 2 * 86_400_000,
};

const DELETED_ENTRY: ActivityEntry = {
  id: '2',
  type: 'deleted',
  credentialName: 'Certificado viejo',
  counterparty: 'ACME Issuer',
  timestamp: Date.now() - 5 * 86_400_000,
};

describe('ActivityPage (EUD-137)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.findAll.mockResolvedValue([]);
    mockAlertController.create.mockResolvedValue({ present: jest.fn() });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-01 -----------------------------------------------------------

  it('AC-01: renders a "presented" entry with credential name and formatted counterparty', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('Empleado ACME');
    expect(el.textContent).toContain('verifier.portal.example');
    expect(el.textContent).not.toContain('https://verifier.portal.example/oid4vp');
  });

  // --- AC-02 -----------------------------------------------------------

  it('AC-02: formatCounterparty reduces a URL counterparty to its hostname', async () => {
    const fixture = await createFixture();
    const result = fixture.componentInstance.formatCounterparty(PRESENTED_ENTRY);

    expect(result).toBe('verifier.portal.example');
  });

  it('AC-02: formatCounterparty returns the raw value when it is not a valid URL', async () => {
    const fixture = await createFixture();
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: 'ACME Issuer' });

    expect(result).toBe('ACME Issuer');
  });

  it('AC-02: formatCounterparty truncates a long did:key counterparty (e.g. same-device Verifier client_id)', async () => {
    const fixture = await createFixture();
    const didKey = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: didKey });

    expect(result).toBe('did:key:z6Mk…sdvktH');
  });

  it('AC-02: formatCounterparty leaves a short did untruncated', async () => {
    const fixture = await createFixture();
    const shortDid = 'did:key:short';
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: shortDid });

    expect(result).toBe(shortDid);
  });

  // --- AC-03 -----------------------------------------------------------

  it('AC-03: renders a "deleted" entry with credential name and counterparty', async () => {
    mockActivityService.findAll.mockResolvedValue([DELETED_ENTRY]);
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('Certificado viejo');
    expect(el.textContent).toContain('ACME Issuer');
  });

  // --- AC-04 -----------------------------------------------------------

  it('AC-04: renders entries in the order returned by findAll (most-recent-first)', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY, DELETED_ENTRY]);
    const fixture = await createFixture();
    const paragraphs: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.activity-item ion-label h2 + p');
    const names = Array.from(paragraphs).map(p => p.textContent?.trim());

    expect(names[0]).toContain('Empleado ACME');
    expect(names[1]).toContain('Certificado viejo');
  });

  it('AC-04: formatTime returns a relative label for timestamps under 7 days', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;
    const twoDaysAgo = Date.now() - 2 * 86_400_000;

    expect(component.formatTime(twoDaysAgo)).toBe('activity.time-days');
  });

  it('AC-04: formatTime returns "time-now" for timestamps under a minute old', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;

    expect(component.formatTime(Date.now())).toBe('activity.time-now');
  });

  it('AC-04: formatTime returns "time-minutes" for timestamps under an hour old', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;
    const tenMinutesAgo = Date.now() - 10 * 60_000;

    expect(component.formatTime(tenMinutesAgo)).toBe('activity.time-minutes');
  });

  it('AC-04: formatTime returns "time-hours" for timestamps under a day old', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;
    const threeHoursAgo = Date.now() - 3 * 3_600_000;

    expect(component.formatTime(threeHoursAgo)).toBe('activity.time-hours');
  });

  // --- AC-06 -----------------------------------------------------------

  it('AC-06: does not render any credential edit/delete controls in the activity list', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY, DELETED_ENTRY]);
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-action="edit-credential"]')).toBeFalsy();
    expect(el.querySelector('[data-action="delete-credential"]')).toBeFalsy();
  });

  it('AC-06: confirmClear() only clears the activity log, not credentials', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    const fixture = await createFixture();
    const component = fixture.componentInstance;

    await component.confirmClear();
    const alertConfig = mockAlertController.create.mock.calls[0][0];
    const clearButton = alertConfig.buttons.find((b: { text: string }) => b.text === 'activity.clear-yes');
    await clearButton.handler();

    expect(mockActivityService.clear).toHaveBeenCalled();
    expect(component.entries).toEqual([]);
  });

  it('confirmClear() shows a "Sí, limpiar"-style confirm button styled as danger', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;

    await component.confirmClear();
    const alertConfig = mockAlertController.create.mock.calls[0][0];
    const clearButton = alertConfig.buttons.find((b: { text: string }) => b.text === 'activity.clear-yes');

    expect(clearButton).toBeTruthy();
    expect(clearButton.cssClass).toBe('danger');
  });

  // --- EC-01 -----------------------------------------------------------

  it('EC-01: shows the empty state when there are no entries', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createFixture();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.empty');
    expect(el.textContent).toContain('activity.empty-hint');
    expect(el.querySelector('.activity-list')).toBeFalsy();
  });

  // --- EC-02 -----------------------------------------------------------

  it('EC-02: renders without a dangling separator when counterparty is empty', async () => {
    const noCounterparty: ActivityEntry = { ...PRESENTED_ENTRY, counterparty: '' };
    mockActivityService.findAll.mockResolvedValue([noCounterparty]);
    const fixture = await createFixture();
    const paragraph = fixture.nativeElement.querySelector('.activity-item ion-label p');

    expect(paragraph.textContent.trim()).toBe('Empleado ACME');
    expect(paragraph.textContent).not.toContain('—');
  });

  // --- EC-03 -----------------------------------------------------------

  it('EC-03: formatTime falls back to toLocaleDateString for timestamps >= 7 days', async () => {
    const fixture = await createFixture();
    const component = fixture.componentInstance;
    const eightDaysAgo = Date.now() - 8 * 86_400_000;

    expect(component.formatTime(eightDaysAgo)).toBe(new Date(eightDaysAgo).toLocaleDateString());
  });

  // --- ionViewWillEnter (Ionic keeps tab pages alive; ngOnInit only runs once) ---

  it('reloads entries on ionViewWillEnter, e.g. after logging an event in another tab', async () => {
    const fixture = await createFixture();
    expect(fixture.componentInstance.entries).toEqual([]);

    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    fixture.componentInstance.ionViewWillEnter();
    await fixture.whenStable();

    expect(fixture.componentInstance.entries).toEqual([PRESENTED_ENTRY]);
  });
});
