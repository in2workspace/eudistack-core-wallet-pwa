import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivityPage } from './activity.page';
import { IonicModule, AlertController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { EventEmitter } from '@angular/core';
import { LangChangeEvent, TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { ActivityService } from 'src/app/core/services/activity.service';
import { ActivityEntry, ActivityFilter, ActivityType } from 'src/app/core/models/activity.model';

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
  get: (key: string) => of(key),
  getBrowserLang: jest.fn().mockReturnValue('en'),
};

const mockActivityService = {
  findAll: jest.fn().mockResolvedValue([]),
  clear: jest.fn().mockResolvedValue(undefined),
};

const mockAlertController = {
  create: jest.fn().mockResolvedValue({ present: jest.fn().mockResolvedValue(undefined) }),
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
  await TestBed.configureTestingModule({
    imports: [ActivityPage, IonicModule.forRoot(), CommonModule, TranslateModule.forRoot()],
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

/** Dispatches an ionChange event on the <ion-segment> as the real control would. */
function selectFilter(fixture: ComponentFixture<ActivityPage>, value: string): void {
  const segment: HTMLElement = fixture.nativeElement.querySelector('ion-segment');
  segment.dispatchEvent(new CustomEvent('ionChange', { detail: { value } }));
  fixture.detectChanges();
}

function credentialNames(fixture: ComponentFixture<ActivityPage>): string[] {
  const paragraphs: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('.activity-item p');
  return Array.from(paragraphs).map((p) => p.textContent!.split('—')[0].trim());
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
    expect(el.querySelectorAll('.activity-dot--issued').length).toBe(2);
    expect(el.querySelectorAll('.activity-dot--deleted').length).toBe(0);
    expect(el.querySelectorAll('.activity-dot--presented').length).toBe(0);
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
    expect(mockAlertController.create).not.toHaveBeenCalled();
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
