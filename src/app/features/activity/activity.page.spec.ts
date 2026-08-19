import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivityPage } from './activity.page';
import { IonicModule, ModalController, ToastController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { EventEmitter } from '@angular/core';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { ActivityService } from 'src/app/core/services/activity.service';
import { ActivityExportService } from 'src/app/core/services/activity-export.service';
import { ActivityEntry, ActivityFilter, ActivityType } from 'src/app/core/models/activity.model';
import { ActivityDetailComponent } from './activity-detail/activity-detail.component';

// jsdom does not implement scrollTo; ion-segment calls it when its active value changes.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = jest.fn();
}

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

const mockActivityService = {
  findAll: jest.fn().mockResolvedValue([]),
  clear: jest.fn().mockResolvedValue(undefined),
  log: jest.fn().mockResolvedValue(undefined),
};

const mockModalController = {
  create: jest.fn().mockResolvedValue({
    present: jest.fn().mockResolvedValue(undefined),
    onWillDismiss: jest.fn().mockResolvedValue({ role: 'cancel' }),
  }),
};

const mockActivityExportService = {
  buildCsv: jest.fn().mockReturnValue('CSV_CONTENT'),
  triggerDownload: jest.fn(),
  buildFileName: jest.fn().mockReturnValue('actividad-wallet-2026-07-20.csv'),
};

const mockToastController = {
  create: jest.fn().mockResolvedValue({
    present: jest.fn().mockResolvedValue(undefined),
  }),
};

const mockRouter = {
  navigate: jest.fn().mockResolvedValue(true),
};

/** Entries as returned by the service: most-recent-first (id-4 is newest). */
const ENTRIES: ActivityEntry[] = [
  { id: '4', type: 'deleted', credentialName: 'Cred D', counterparty: 'Issuer D', timestamp: 4000 },
  { id: '3', type: 'issued', credentialName: 'Cred C', counterparty: 'Issuer C', timestamp: 3000 },
  { id: '2', type: 'presented', credentialName: 'Cred B', counterparty: 'Verifier B', timestamp: 2000 },
  { id: '1', type: 'issued', credentialName: 'Cred A', counterparty: 'Issuer A', timestamp: 1000 },
];

/** 200 entries (MAX_ENTRIES) mixed across the three types, most-recent-first. */
const LARGE_ENTRIES: ActivityEntry[] = Array.from({ length: 200 }, (_, i) => {
  const rank = 200 - i; // rank 200 = newest (i=0), rank 1 = oldest (i=199)
  const types: ActivityType[] = ['issued', 'presented', 'deleted'];
  return {
    id: `${rank}`,
    type: types[rank % types.length],
    credentialName: `Cred ${rank}`,
    counterparty: `Party ${rank}`,
    timestamp: rank * 1000,
  };
});

async function createModule(): Promise<ComponentFixture<ActivityPage>> {
  // ActivityPage's own standalone `imports: [IonicModule, ...]` resolves a fresh ModalController
  // scoped to the component's injector, shadowing a TestBed-level provider override. Overriding
  // the component's own providers ensures the mock wins at the component's element injector.
  TestBed.overrideComponent(ActivityPage, {
    add: {
      providers: [
        { provide: ModalController, useValue: mockModalController },
        { provide: ToastController, useValue: mockToastController },
      ],
    },
  });

  await TestBed.configureTestingModule({
    imports: [ActivityPage, IonicModule.forRoot(), CommonModule, TranslateModule.forRoot()],
    providers: [
      { provide: ActivityService, useValue: mockActivityService },
      { provide: ActivityExportService, useValue: mockActivityExportService },
      { provide: ModalController, useValue: mockModalController },
      { provide: ToastController, useValue: mockToastController },
      { provide: TranslateService, useValue: translateServiceMock },
      { provide: Router, useValue: mockRouter },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(ActivityPage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture;
}

/** Dispatches an ionChange event on the <ion-segment> as the real control would. */
function selectFilter(fixture: ComponentFixture<ActivityPage>, value: string): void {
  const segment: HTMLElement = fixture.nativeElement.querySelector('ion-segment');
  segment.dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  fixture.detectChanges();
}

function credentialNames(fixture: ComponentFixture<ActivityPage>): string[] {
  const names: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.activity-credential-name');
  return Array.from(names).map((p) => p.textContent!.trim());
}

/** Clicks the nth rendered `.activity-card`, as a user opening the detail modal would. */
function clickCard(fixture: ComponentFixture<ActivityPage>, index = 0): void {
  const cards: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.activity-card');
  cards[index].dispatchEvent(new MouseEvent('click'));
  fixture.detectChanges();
}

describe('ActivityPage > filtro de actividad por tipo (EUD-138)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('debe renderizar el control de filtro con las cuatro opciones y "Todas" activo por defecto', async () => {
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    const buttons: NodeListOf<HTMLElement> = el.querySelectorAll('ion-segment-button');
    expect(buttons.length).toBe(4);

    const values = Array.from(buttons).map((b) => (b as unknown as { value: string }).value);
    expect(values).toEqual(['all', 'issued', 'presented', 'deleted']);

    expect(fixture.componentInstance.activeFilter()).toBe('all');
    const segment = el.querySelector('ion-segment') as unknown as { value: string };
    expect(segment.value).toBe('all');
  });

  it('AC-02: debe filtrar por un tipo mostrando solo eventos de ese tipo, preservando el orden más-reciente-primero', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');

    expect(fixture.componentInstance.filteredEntries()).toEqual([ENTRIES[1], ENTRIES[3]]);

    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.activity-card--issued').length).toBe(2);
    expect(el.querySelectorAll('.activity-card--deleted').length).toBe(0);
    expect(el.querySelectorAll('.activity-card--presented').length).toBe(0);
    expect(credentialNames(fixture)).toEqual(['Cred C', 'Cred A']);
  });

  it('AC-03: al volver a "Todas" debe mostrar de nuevo todos los eventos preservando el orden original', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');
    selectFilter(fixture, 'all');

    expect(fixture.componentInstance.activeFilter()).toBe('all');
    expect(fixture.componentInstance.filteredEntries()).toEqual(ENTRIES);
    expect(credentialNames(fixture)).toEqual(['Cred D', 'Cred C', 'Cred B', 'Cred A']);
  });

  // --- AC-04 -----------------------------------------------------------

  it('AC-04: cambiar de filtro no vuelve a invocar ActivityService.findAll()', async () => {
    const fixture = await createModule();
    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);

    selectFilter(fixture, 'issued');
    selectFilter(fixture, 'presented');
    selectFilter(fixture, 'deleted');
    selectFilter(fixture, 'all');

    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);
  });

  it('AC-04: cambiar de filtro no invoca ActivityService.clear() ni abre el diálogo de confirmClear()', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');
    selectFilter(fixture, 'presented');
    selectFilter(fixture, 'all');

    expect(mockActivityService.clear).not.toHaveBeenCalled();
    expect(mockModalController.create).not.toHaveBeenCalled();
  });

  it('AC-04: cambiar de filtro no muta el conjunto de entries()', async () => {
    const fixture = await createModule();
    const entriesBefore = fixture.componentInstance.entries();

    selectFilter(fixture, 'issued');
    selectFilter(fixture, 'presented');
    selectFilter(fixture, 'all');

    const entriesAfter = fixture.componentInstance.entries();
    expect(entriesAfter).toBe(entriesBefore);
    expect(entriesAfter).toEqual(ENTRIES);
  });

  // --- EC-01 -----------------------------------------------------------

  it('EC-01: filtro sin eventos de ese tipo muestra el copy contextual y mantiene el control operable', async () => {
    // Historial con actividad, pero ninguna entrada de tipo "deleted".
    mockActivityService.findAll.mockResolvedValue([ENTRIES[1], ENTRIES[3]]);
    const fixture = await createModule();

    selectFilter(fixture, 'deleted');

    const el: HTMLElement = fixture.nativeElement;
    const stateContainer = el.querySelector('.state-container');
    expect(stateContainer).toBeTruthy();
    expect(stateContainer!.textContent).toContain('activity.empty-deleted');
    // Debe ser el copy contextual, no el genérico (sin empty-hint ni "activity.empty" a secas).
    expect(el.querySelector('.empty-hint')).toBeFalsy();
    expect(el.querySelector('.activity-list')).toBeFalsy();

    // El control de filtro sigue presente y operable: se puede volver a "Todas".
    expect(el.querySelectorAll('ion-segment-button').length).toBe(4);
    selectFilter(fixture, 'all');
    expect(fixture.componentInstance.filteredEntries().length).toBe(2);
    expect(el.querySelector('.activity-list')).toBeTruthy();
  });

  // --- EC-02 -----------------------------------------------------------

  it('EC-02: historial totalmente vacío con filtro "Todas" muestra el estado vacío genérico existente', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();

    expect(fixture.componentInstance.activeFilter()).toBe('all');

    const el: HTMLElement = fixture.nativeElement;
    const stateContainer = el.querySelector('.state-container');
    expect(stateContainer).toBeTruthy();
    expect(stateContainer!.textContent).toContain('activity.empty');
    expect(el.querySelector('.empty-hint')).toBeTruthy();
    expect(el.querySelector('.empty-hint')!.textContent).toContain('activity.empty-hint');
    expect(el.querySelector('.activity-list')).toBeFalsy();
  });

  // --- EC-03 -----------------------------------------------------------

  it('EC-03: con 200 entradas (MAX_ENTRIES) mezcladas, alternar filtros no recarga desde ActivityService', async () => {
    mockActivityService.findAll.mockResolvedValue(LARGE_ENTRIES);
    const fixture = await createModule();
    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);

    const filtersToCycle: ActivityFilter[] = ['issued', 'presented', 'deleted', 'all', 'presented', 'issued', 'all'];
    for (const filter of filtersToCycle) {
      selectFilter(fixture, filter);
    }

    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.entries().length).toBe(200);
    expect(fixture.componentInstance.activeFilter()).toBe('all');
    expect(fixture.componentInstance.filteredEntries().length).toBe(200);
  });

  // --- EC-04 -----------------------------------------------------------

  it('EC-04: reseleccionar el filtro ya activo no dispara recómputo observable ni parpadeo', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');
    const firstRef = fixture.componentInstance.filteredEntries();
    expect(fixture.componentInstance.loading()).toBe(false);

    selectFilter(fixture, 'issued'); // mismo valor ya activo

    const secondRef = fixture.componentInstance.filteredEntries();
    expect(secondRef).toBe(firstRef); // misma instancia => el computed no se ha reevaluado
    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1); // sin recarga
    expect(fixture.componentInstance.loading()).toBe(false); // sin parpadeo a estado de carga
  });

  // --- ES-01 -----------------------------------------------------------

  it('ES-01: un evento con type desconocido/ausente queda excluido de los filtros específicos pero visible en "Todas" sin lanzar excepción', async () => {
    const unknownTypeEntry = {
      id: 'x1',
      type: 'unknown' as unknown as ActivityType,
      credentialName: 'Cred Unknown',
      counterparty: 'Party X',
      timestamp: 5000,
    };
    const missingTypeEntry = {
      id: 'x2',
      type: undefined as unknown as ActivityType,
      credentialName: 'Cred Missing',
      counterparty: 'Party Y',
      timestamp: 6000,
    };
    mockActivityService.findAll.mockResolvedValue([missingTypeEntry, unknownTypeEntry, ...ENTRIES]);

    const fixture = await createModule();

    // Visibles bajo "Todas", sin excepción durante el render inicial.
    expect(fixture.componentInstance.activeFilter()).toBe('all');
    expect(credentialNames(fixture)).toEqual(
      expect.arrayContaining(['Cred Missing', 'Cred Unknown', 'Cred D', 'Cred C', 'Cred B', 'Cred A'])
    );

    // Excluidos de cada filtro específico, sin lanzar excepción al alternar.
    for (const filter of ['issued', 'presented', 'deleted'] as ActivityFilter[]) {
      expect(() => selectFilter(fixture, filter)).not.toThrow();
      const ids = fixture.componentInstance.filteredEntries().map((e) => e.id);
      expect(ids).not.toContain('x1');
      expect(ids).not.toContain('x2');
    }
  });

  // --- ES-02 -----------------------------------------------------------

  it('ES-02: findAll() devolviendo [] no rompe el control de filtro ni el render', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    // El control de filtro se sigue renderizando con las cuatro opciones.
    expect(el.querySelectorAll('ion-segment-button').length).toBe(4);

    // Interactuar con el control sobre un historial vacío no lanza excepción ni rompe el render.
    for (const filter of ['issued', 'presented', 'deleted', 'all'] as ActivityFilter[]) {
      expect(() => selectFilter(fixture, filter)).not.toThrow();
      expect(fixture.componentInstance.filteredEntries()).toEqual([]);
    }

    expect(el.querySelector('.activity-list')).toBeFalsy();
    expect(el.querySelector('.state-container')).toBeTruthy();
    expect(el.querySelectorAll('ion-segment-button').length).toBe(4);
  });
});

describe('ActivityPage (EUD-137)', () => {
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

  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.findAll.mockResolvedValue([]);
    mockModalController.create.mockResolvedValue({
      present: jest.fn().mockResolvedValue(undefined),
      onWillDismiss: jest.fn().mockResolvedValue({ role: 'cancel' }),
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-01 / AC-02 -----------------------------------------------------

  it('AC-01/AC-02: passes the normalized (hostname) counterparty into the "presented" subtitle translation, not the raw URL', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    const fixture = await createModule();

    expect(translateServiceMock.get).toHaveBeenCalledWith('activity.subtitle-presented', {
      counterparty: 'verifier.portal.example',
    });
    expect(fixture.nativeElement.textContent).not.toContain('https://verifier.portal.example/oid4vp');
  });

  it('AC-02: formatCounterparty reduces a URL counterparty to its hostname', async () => {
    const fixture = await createModule();
    const result = fixture.componentInstance.formatCounterparty(PRESENTED_ENTRY);

    expect(result).toBe('verifier.portal.example');
  });

  it('AC-02: formatCounterparty returns the raw value when it is not a valid URL', async () => {
    const fixture = await createModule();
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: 'ACME Issuer' });

    expect(result).toBe('ACME Issuer');
  });

  it('AC-02: formatCounterparty truncates a long did:key counterparty (e.g. same-device Verifier client_id)', async () => {
    const fixture = await createModule();
    const didKey = 'did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH';
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: didKey });

    expect(result).toBe('did:key:z6Mk…sdvktH');
  });

  it('AC-02: formatCounterparty leaves a short did untruncated', async () => {
    const fixture = await createModule();
    const shortDid = 'did:key:short';
    const result = fixture.componentInstance.formatCounterparty({ ...PRESENTED_ENTRY, counterparty: shortDid });

    expect(result).toBe(shortDid);
  });

  // --- AC-03 -------------------------------------------------------------

  it('AC-03: renders a "deleted" entry with credential name and no counterparty subtitle (current card design)', async () => {
    mockActivityService.findAll.mockResolvedValue([DELETED_ENTRY]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('Certificado viejo');
    expect(el.querySelector('.activity-card--deleted .activity-subtitle')).toBeFalsy();
  });

  // --- AC-04 ---------------------------------------------------------------

  it('AC-04: renders entries in the order returned by findAll (most-recent-first)', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY, DELETED_ENTRY]);
    const fixture = await createModule();

    expect(credentialNames(fixture)).toEqual(['Empleado ACME', 'Certificado viejo']);
  });

  it('AC-04: formatTime labels today\'s entries with the "Today · hh:mm" form', async () => {
    const fixture = await createModule();
    const component = fixture.componentInstance;
    const todayAt0922 = new Date();
    todayAt0922.setHours(9, 22, 0, 0);

    expect(component.formatTime(todayAt0922.getTime())).toBe('activity.date-today · 09:22 am');
  });

  it('AC-04: formatTime renders older entries as "DD Mon YYYY · hh:mm"', async () => {
    const fixture = await createModule();
    const component = fixture.componentInstance;
    const past = new Date(2026, 5, 5, 9, 12, 0, 0); // 05 Jun 2026, 09:12

    expect(component.formatTime(past.getTime())).toBe('05 Jun 2026 · 09:12 am');
  });

  // --- AC-06 -----------------------------------------------------------

  it('AC-06: does not render any credential edit/delete controls in the activity list', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY, DELETED_ENTRY]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('[data-action="edit-credential"]')).toBeFalsy();
    expect(el.querySelector('[data-action="delete-credential"]')).toBeFalsy();
  });

  it('AC-06: confirmClear() only clears the activity log, not credentials, when the modal resolves with role "confirm"', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    mockModalController.create.mockResolvedValueOnce({
      present: jest.fn().mockResolvedValue(undefined),
      onWillDismiss: jest.fn().mockResolvedValue({ role: 'confirm' }),
    });
    const fixture = await createModule();
    const component = fixture.componentInstance;

    await component.confirmClear();

    expect(mockActivityService.clear).toHaveBeenCalled();
    expect(component.entries()).toEqual([]);
  });

  it('AC-06: confirmClear() does not clear when the modal is dismissed with role "cancel"', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    const fixture = await createModule();
    const component = fixture.componentInstance;

    await component.confirmClear();

    expect(mockActivityService.clear).not.toHaveBeenCalled();
    expect(component.entries().length).toBe(1);
  });

  it('confirmClear() opens the confirm modal with the "Clear history" action drawn in the mock', async () => {
    const fixture = await createModule();
    const component = fixture.componentInstance;

    await component.confirmClear();

    expect(mockModalController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        componentProps: expect.objectContaining({
          actionKey: 'activity.clear-action',
          actionVariant: 'primary',
        }),
      })
    );
  });

  // --- EC-01 -----------------------------------------------------------

  it('EC-01: shows the empty state when there are no entries', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.empty');
    expect(el.textContent).toContain('activity.empty-hint');
    expect(el.querySelector('.activity-list')).toBeFalsy();
  });

  it('EC-01: the empty state offers the "Add credential" CTA, which opens the scanner', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();
    const cta: HTMLElement = fixture.nativeElement.querySelector('.empty-cta');

    expect(cta).toBeTruthy();
    cta.dispatchEvent(new MouseEvent('click'));

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials'], {
      queryParams: { showScannerView: true, showScanner: true },
    });
  });

  it('EC-01: export stays visible but disabled while the history is empty', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector<HTMLButtonElement>('.export-btn')!.disabled).toBe(true);
  });

  // Product has not decided whether the wallet keeps this action, so the button
  // is hidden behind `clearHistoryEnabled` while the flow itself stays wired.
  it('does not render the clear-history button while the feature flag is off', async () => {
    const fixture = await createModule();

    expect(fixture.componentInstance.clearHistoryEnabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.clear-btn')).toBeFalsy();
  });

  it('renders the clear-history button when the feature flag is on', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    const fixture = await createModule();
    (fixture.componentInstance as { clearHistoryEnabled: boolean }).clearHistoryEnabled = true;
    fixture.detectChanges();

    const clear: HTMLElement = fixture.nativeElement.querySelector('.clear-btn');
    expect(clear).toBeTruthy();

    clear.dispatchEvent(new MouseEvent('click'));
    await fixture.whenStable();

    expect(mockModalController.create).toHaveBeenCalled();
  });

  it('the header back link returns to the credential list', async () => {
    const fixture = await createModule();
    const back: HTMLElement = fixture.nativeElement.querySelector('.back-link');

    expect(back).toBeTruthy();
    back.dispatchEvent(new MouseEvent('click'));

    expect(mockRouter.navigate).toHaveBeenCalledWith(['/tabs/credentials']);
  });

  // --- EC-02 -----------------------------------------------------------

  it('EC-02: renders no subtitle line when counterparty is empty (no dangling separator)', async () => {
    const noCounterparty: ActivityEntry = { ...PRESENTED_ENTRY, counterparty: '' };
    mockActivityService.findAll.mockResolvedValue([noCounterparty]);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.querySelector('.activity-subtitle')).toBeFalsy();
    expect(el.querySelector('.activity-credential-name')!.textContent!.trim()).toBe('Empleado ACME');
  });

  // --- EC-03 -----------------------------------------------------------

  it('EC-03: formatTime keeps the absolute date form for entries older than today', async () => {
    const fixture = await createModule();
    const component = fixture.componentInstance;
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000);

    expect(component.formatTime(eightDaysAgo.getTime())).not.toContain('activity.date-today');
    expect(component.formatTime(eightDaysAgo.getTime())).toMatch(/^\d{2} \w+ \d{4} · /);
  });

  // --- ionViewWillEnter (Ionic keeps tab pages alive; ngOnInit only runs once) ---

  it('reloads entries on ionViewWillEnter, e.g. after logging an event in another tab', async () => {
    const fixture = await createModule();
    expect(fixture.componentInstance.entries()).toEqual([]);

    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    fixture.componentInstance.ionViewWillEnter();
    await fixture.whenStable();

    expect(fixture.componentInstance.entries()).toEqual([PRESENTED_ENTRY]);
  });

  // --- translate="no" shielding (EUD-142, AC-10, NFR-S-142-08) ------------
  // credentialName and the counterparty are credential/requester-provenance
  // content and must never be handed to a translation engine nor left
  // translatable by the browser's page translation — same guarantee as the
  // detail view (activity-detail.component.spec.ts).
  describe('translate="no" shielding (AC-10, NFR-S-142-08)', () => {
    it('marks the credential name as non-translatable', async () => {
      mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
      const fixture = await createModule();

      const name = fixture.nativeElement.querySelector('.activity-credential-name');
      expect(name.getAttribute('translate')).toBe('no');
      expect(name.textContent.trim()).toBe('Empleado ACME');
    });

    it('marks the counterparty subtitle as non-translatable', async () => {
      mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
      const fixture = await createModule();

      const subtitle = fixture.nativeElement.querySelector('.activity-subtitle');
      expect(subtitle.getAttribute('translate')).toBe('no');
    });

    it('never includes credentialName in the card aria-label', async () => {
      mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
      const fixture = await createModule();

      const card = fixture.nativeElement.querySelector('.activity-card');
      expect(card.getAttribute('aria-label')).not.toContain('Empleado ACME');
    });
  });
});

describe('ActivityPage — activity detail modal (EUD-139)', () => {
  const PRESENTED_ENTRY: ActivityEntry = {
    id: '1',
    type: 'presented',
    credentialName: 'Empleado ACME',
    counterparty: 'https://verifier.portal.example/oid4vp',
    timestamp: Date.now() - 2 * 86_400_000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    mockModalController.create.mockResolvedValue({
      present: jest.fn().mockResolvedValue(undefined),
      onWillDismiss: jest.fn().mockResolvedValue({ role: 'close' }),
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-05 ---------------------------------------------------------------

  it('AC-05: opening and closing the detail modal (via openDetail) preserves the active filter', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');
    expect(fixture.componentInstance.activeFilter()).toBe('issued');
    const filteredBefore = fixture.componentInstance.filteredEntries();

    const modalInstance = {
      present: jest.fn().mockResolvedValue(undefined),
      onWillDismiss: jest.fn().mockResolvedValue({ role: 'close' }),
    };
    mockModalController.create.mockResolvedValueOnce(modalInstance);

    await fixture.componentInstance.openDetail(ENTRIES[1]);
    await modalInstance.onWillDismiss(); // simulate the user dismissing the modal
    fixture.detectChanges();

    expect(fixture.componentInstance.activeFilter()).toBe('issued');
    expect(fixture.componentInstance.filteredEntries()).toEqual(filteredBefore);
  });

  it('AC-05: opening the detail modal from a card click preserves the active filter and reuses the entry', async () => {
    const fixture = await createModule();

    selectFilter(fixture, 'issued');
    expect(credentialNames(fixture)).toEqual(['Cred C', 'Cred A']);

    clickCard(fixture, 0);
    await fixture.whenStable();

    expect(mockModalController.create).toHaveBeenCalledWith(
      expect.objectContaining({
        component: ActivityDetailComponent,
        componentProps: { entry: ENTRIES[1], locale: 'en' }, // 'Cred C', first of the 'issued' filtered list
      })
    );
    expect(fixture.componentInstance.activeFilter()).toBe('issued');
    expect(credentialNames(fixture)).toEqual(['Cred C', 'Cred A']);
  });

  it('AC-05: closing the modal does not reload or mutate entries()', async () => {
    const fixture = await createModule();
    const entriesBefore = fixture.componentInstance.entries();
    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);

    await fixture.componentInstance.openDetail(ENTRIES[0]);

    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.entries()).toBe(entriesBefore);
  });

  // --- ES-02 -----------------------------------------------------------------

  it('ES-02: openDetail(undefined) does not create a modal (guard)', async () => {
    const fixture = await createModule();

    await fixture.componentInstance.openDetail(undefined);

    expect(mockModalController.create).not.toHaveBeenCalled();
  });

  it('ES-02: openDetail(null) does not create a modal (guard)', async () => {
    const fixture = await createModule();

    await fixture.componentInstance.openDetail(null);

    expect(mockModalController.create).not.toHaveBeenCalled();
  });

  it('ES-02: the guard does not throw and leaves the active filter untouched', async () => {
    const fixture = await createModule();
    selectFilter(fixture, 'presented');

    await expect(fixture.componentInstance.openDetail(undefined)).resolves.toBeUndefined();

    expect(fixture.componentInstance.activeFilter()).toBe('presented');
    expect(mockModalController.create).not.toHaveBeenCalled();
  });

  it('reference: presenting a valid entry does create the modal (control case for the ES-02 guard)', async () => {
    mockActivityService.findAll.mockResolvedValue([PRESENTED_ENTRY]);
    const fixture = await createModule();

    await fixture.componentInstance.openDetail(PRESENTED_ENTRY);

    expect(mockModalController.create).toHaveBeenCalledTimes(1);
  });
});

/** Locates the "Exportar historial" button rendered in `.activity-header`. */
function exportButton(fixture: ComponentFixture<ActivityPage>): HTMLElement | null {
  return fixture.nativeElement.querySelector('.export-btn');
}

describe('ActivityPage — exportar historial a CSV (EUD-140)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    mockActivityExportService.buildCsv.mockReturnValue('CSV_CONTENT');
    mockActivityExportService.buildFileName.mockReturnValue('actividad-wallet-2026-07-20.csv');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-01 -------------------------------------------------------------

  it('AC-01: clicking "Exportar historial" invokes buildCsv + triggerDownload with the full entries()', async () => {
    const fixture = await createModule();
    const button = exportButton(fixture);
    expect(button).toBeTruthy();

    button!.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(mockActivityExportService.buildCsv).toHaveBeenCalledWith(ENTRIES, expect.any(Object));
    expect(mockActivityExportService.triggerDownload).toHaveBeenCalledWith(
      'CSV_CONTENT',
      'actividad-wallet-2026-07-20.csv'
    );
  });

  it('AC-01: resolves the i18n headers/type labels passed to buildCsv', async () => {
    const fixture = await createModule();

    fixture.componentInstance.exportHistory();

    expect(mockActivityExportService.buildCsv).toHaveBeenCalledWith(ENTRIES, {
      headers: {
        type: 'activity.csv-header-type',
        credentialName: 'activity.csv-header-credential',
        counterparty: 'activity.csv-header-counterparty',
        timestamp: 'activity.csv-header-date',
        details: 'activity.csv-header-details',
      },
      types: {
        issued: 'activity.type-issued',
        presented: 'activity.type-presented',
        deleted: 'activity.type-deleted',
      },
    });
  });

  // --- AC-05 -------------------------------------------------------------

  it('AC-05: exporting with a filter active still sends the full entries(), not filteredEntries()', async () => {
    const fixture = await createModule();
    selectFilter(fixture, 'issued');
    expect(fixture.componentInstance.filteredEntries().length).toBe(2); // only the 'issued' entries

    fixture.componentInstance.exportHistory();

    expect(mockActivityExportService.buildCsv).toHaveBeenCalledWith(ENTRIES, expect.any(Object));
  });

  it('AC-05: exporting does not alter the active filter shown on screen', async () => {
    const fixture = await createModule();
    selectFilter(fixture, 'presented');

    fixture.componentInstance.exportHistory();

    expect(fixture.componentInstance.activeFilter()).toBe('presented');
  });

  // --- AC-06 -------------------------------------------------------------

  it('AC-06: exporting does not call ActivityService.log() or ActivityService.clear()', async () => {
    const fixture = await createModule();

    fixture.componentInstance.exportHistory();

    expect(mockActivityService.log).not.toHaveBeenCalled();
    expect(mockActivityService.clear).not.toHaveBeenCalled();
    expect(mockActivityService.findAll).toHaveBeenCalledTimes(1); // no reload from storage
  });

  it('AC-06: exporting does not mutate entries() (same reference before/after)', async () => {
    const fixture = await createModule();
    const entriesBefore = fixture.componentInstance.entries();

    fixture.componentInstance.exportHistory();

    expect(fixture.componentInstance.entries()).toBe(entriesBefore);
    expect(fixture.componentInstance.entries()).toEqual(ENTRIES);
  });

  it('AC-06: exporting leaves the rendered list unchanged', async () => {
    const fixture = await createModule();
    const before = credentialNames(fixture);

    fixture.componentInstance.exportHistory();
    fixture.detectChanges();

    expect(credentialNames(fixture)).toEqual(before);
  });
});

describe('ActivityPage — exportar historial: disponibilidad y resiliencia (EUD-140)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActivityExportService.buildCsv.mockReturnValue('CSV_CONTENT');
    mockActivityExportService.buildFileName.mockReturnValue('actividad-wallet-2026-07-20.csv');
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- ES-02 ---------------------------------------------------------------

  it('ES-02: the "Exportar historial" button is disabled when the history is empty', async () => {
    mockActivityService.findAll.mockResolvedValue([]);
    const fixture = await createModule();

    expect((exportButton(fixture) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ES-02: the button becomes enabled once entries are present', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    const fixture = await createModule();

    expect((exportButton(fixture) as HTMLButtonElement).disabled).toBe(false);
  });

  // --- ES-03 ---------------------------------------------------------------

  it('ES-03: shows an i18n error toast when triggerDownload fails, without throwing', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    mockActivityExportService.triggerDownload.mockImplementation(() => {
      throw new Error('download blocked');
    });
    const fixture = await createModule();

    expect(() => fixture.componentInstance.exportHistory()).not.toThrow();
    await fixture.whenStable();

    expect(mockToastController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'activity.export-error' })
    );
  });

  it('ES-03: a failed export does not mutate entries() or call ActivityService.log()/clear()', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    mockActivityExportService.triggerDownload.mockImplementation(() => {
      throw new Error('download blocked');
    });
    const fixture = await createModule();
    const entriesBefore = fixture.componentInstance.entries();

    fixture.componentInstance.exportHistory();
    await fixture.whenStable();

    expect(fixture.componentInstance.entries()).toBe(entriesBefore);
    expect(mockActivityService.log).not.toHaveBeenCalled();
    expect(mockActivityService.clear).not.toHaveBeenCalled();
  });

  it('ES-03: buildCsv failing also surfaces the error toast (no partial file reaches triggerDownload)', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    mockActivityExportService.buildCsv.mockImplementation(() => {
      throw new Error('serialization failed');
    });
    const fixture = await createModule();

    fixture.componentInstance.exportHistory();
    await fixture.whenStable();

    expect(mockActivityExportService.triggerDownload).not.toHaveBeenCalled();
    expect(mockToastController.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'activity.export-error' })
    );
  });

  // --- EC-03 (component-level) ----------------------------------------------

  it('EC-03: exporting 200 mixed entries completes synchronously without blocking further interaction', async () => {
    mockActivityService.findAll.mockResolvedValue(LARGE_ENTRIES);
    const fixture = await createModule();

    const start = performance.now();
    fixture.componentInstance.exportHistory();
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(mockActivityExportService.buildCsv).toHaveBeenCalledWith(LARGE_ENTRIES, expect.any(Object));

    // The UI remains interactive right after export: the filter control still responds.
    selectFilter(fixture, 'issued');
    expect(fixture.componentInstance.activeFilter()).toBe('issued');
  });
});

describe('ActivityPage — historial recuperado del servidor (EUD-141)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // --- AC-07 -----------------------------------------------------------

  it('AC-07: rendering entries recovered from the server exposes no manual sync/write action', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    // No control to trigger a manual server sync exists in the template — recovery/sync
    // happens transparently inside ActivityService.findAll()/syncFromServer().
    expect(el.querySelector('[data-action="sync"]')).toBeFalsy();
    expect(el.querySelector('.sync-btn')).toBeFalsy();
    expect(mockActivityService.log).not.toHaveBeenCalled();
  });

  it('AC-07: reloading the view (ionViewWillEnter) only re-reads the history, it never writes', async () => {
    mockActivityService.findAll.mockResolvedValue(ENTRIES);
    const fixture = await createModule();

    fixture.componentInstance.ionViewWillEnter();
    await fixture.whenStable();

    expect(mockActivityService.findAll).toHaveBeenCalledTimes(2);
    expect(mockActivityService.log).not.toHaveBeenCalled();
    expect(mockActivityService.clear).not.toHaveBeenCalled();
  });

  // --- EC-04 -------------------------------------------------------------

  it('EC-04: an empty history recovered from the server renders the empty state, not an error', async () => {
    mockActivityService.findAll.mockResolvedValue([]); // e.g. GET /api/v1/activity -> []
    const fixture = await createModule();
    const el: HTMLElement = fixture.nativeElement;

    expect(el.textContent).toContain('activity.empty');
    expect(el.querySelector('.activity-list')).toBeFalsy();
    expect(fixture.componentInstance.loading()).toBe(false);
  });
});
