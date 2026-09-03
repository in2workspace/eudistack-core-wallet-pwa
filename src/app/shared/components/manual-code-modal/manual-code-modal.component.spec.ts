import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { ManualCodeModalComponent } from './manual-code-modal.component';

const modalCtrlMock = { dismiss: jest.fn().mockResolvedValue(true) };

async function createFixture(): Promise<ComponentFixture<ManualCodeModalComponent>> {
  TestBed.overrideComponent(ManualCodeModalComponent, {
    add: { providers: [{ provide: ModalController, useValue: modalCtrlMock }] },
  });

  await TestBed.configureTestingModule({
    imports: [ManualCodeModalComponent, IonicModule.forRoot(), TranslateModule.forRoot()],
    providers: [{ provide: ModalController, useValue: modalCtrlMock }],
  }).compileComponents();

  const fixture = TestBed.createComponent(ManualCodeModalComponent);
  fixture.detectChanges();
  return fixture;
}

function input(fixture: ComponentFixture<ManualCodeModalComponent>): HTMLInputElement {
  return fixture.nativeElement.querySelector('#manual-code-input');
}

function continueButton(fixture: ComponentFixture<ManualCodeModalComponent>): HTMLButtonElement {
  return fixture.nativeElement.querySelector('.btn-primary');
}

describe('ManualCodeModalComponent', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => TestBed.resetTestingModule());

  it('keeps "Continue" disabled until a non-blank code is typed', async () => {
    const fixture = await createFixture();

    expect(continueButton(fixture).disabled).toBe(true);

    fixture.componentInstance.onInput('   ');
    fixture.detectChanges();
    expect(continueButton(fixture).disabled).toBe(true);

    fixture.componentInstance.onInput('ABC-123');
    fixture.detectChanges();
    expect(continueButton(fixture).disabled).toBe(false);
  });

  it('dismisses with the trimmed code when confirmed', async () => {
    const fixture = await createFixture();

    fixture.componentInstance.onInput('  ABC-123  ');
    fixture.detectChanges();
    continueButton(fixture).dispatchEvent(new MouseEvent('click'));

    expect(modalCtrlMock.dismiss).toHaveBeenCalledWith('ABC-123', 'confirm');
  });

  it('never dismisses with a blank code', async () => {
    const fixture = await createFixture();

    fixture.componentInstance.onInput('   ');
    fixture.componentInstance.submit();

    expect(modalCtrlMock.dismiss).not.toHaveBeenCalled();
  });

  it('returns to the scanner without a code on cancel', async () => {
    const fixture = await createFixture();

    fixture.componentInstance.onInput('ABC-123');
    fixture.nativeElement.querySelector('.btn-link').dispatchEvent(new MouseEvent('click'));

    expect(modalCtrlMock.dismiss).toHaveBeenCalledWith(null, 'cancel');
  });

  it('renders the access-code field the mock describes', async () => {
    const fixture = await createFixture();

    expect(input(fixture)).toBeTruthy();
    expect(fixture.nativeElement.textContent).toContain('scanner.manual-title');
    expect(fixture.nativeElement.textContent).toContain('scanner.manual-description');
    expect(fixture.nativeElement.textContent).toContain('scanner.manual-back');
  });
});
