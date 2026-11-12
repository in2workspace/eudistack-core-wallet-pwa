import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { FilterOption, FilterSelectComponent } from './filter-select.component';

describe('FilterSelectComponent', () => {
  let fixture: ComponentFixture<FilterSelectComponent>;
  let component: FilterSelectComponent;

  const options: FilterOption[] = [
    { value: 'Employee', label: 'Employee' },
    { value: 'VALID', label: 'vc-view.lifecycle-valid', translate: true },
  ];

  function render(value = ''): void {
    fixture.componentRef.setInput('label', 'credentials.filters.type');
    fixture.componentRef.setInput('options', options);
    fixture.componentRef.setInput('value', value);
    fixture.detectChanges();
  }

  const pill = (): HTMLButtonElement => fixture.nativeElement.querySelector('button.filter');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FilterSelectComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(FilterSelectComponent);
    component = fixture.componentInstance;
  });

  it('renders the pill as a button that opens a popup', () => {
    render();

    expect(pill()).toBeTruthy();
    expect(pill().type).toBe('button');
    expect(pill().getAttribute('aria-haspopup')).toBe('dialog');
    expect(pill().getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the name of the filter and "all" while no value is chosen', () => {
    render();

    expect(fixture.nativeElement.querySelector('.filter__label').textContent).toContain('credentials.filters.type');
    expect(fixture.nativeElement.querySelector('.filter__value').textContent).toContain('credentials.filters.all');
    expect(pill().classList).not.toContain('filter--active');
  });

  it('shows the chosen value and marks the pill as active', () => {
    render('Employee');

    expect(fixture.nativeElement.querySelector('.filter__value').textContent).toContain('Employee');
    expect(pill().classList).toContain('filter--active');
  });

  it('shows the value itself, not "all", when it is no longer among the options', () => {
    render('Machine');

    expect(fixture.nativeElement.querySelector('.filter__value').textContent).toContain('Machine');
    expect(fixture.nativeElement.querySelector('.filter__value').textContent).not.toContain('credentials.filters.all');
    expect(pill().classList).toContain('filter--active');
  });

  it('translates the label of an option that is a translation key', () => {
    render('VALID');

    expect(fixture.nativeElement.querySelector('.filter__value').textContent).toContain('vc-view.lifecycle-valid');
  });

  it('gives each pill its own trigger id', () => {
    const other = TestBed.createComponent(FilterSelectComponent);
    render();
    other.componentRef.setInput('label', 'credentials.filters.issuer');
    other.detectChanges();

    expect(pill().id).not.toBe(other.nativeElement.querySelector('button.filter').id);
  });

  it('choose emits the picked value', () => {
    render();
    const emitted: string[] = [];
    component.valueChange.subscribe(value => emitted.push(value));

    component.choose('Employee');
    component.choose('');

    expect(emitted).toEqual(['Employee', '']);
  });
});
