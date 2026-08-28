import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { TranslateModule } from '@ngx-translate/core';
import { CredentialConfirmationModalComponent } from './credential-confirmation-modal.component';
import { CredentialPreview } from 'src/app/core/models/credential-preview';

const mockModalController = {
  dismiss: jest.fn(),
};

const BASE_PREVIEW: CredentialPreview = {
  displayName: 'LEAR Credential Employee',
  format: 'vc+sd-jwt',
  fields: [],
  sections: [
    {
      section: 'Employee',
      fields: [
        { label: 'First name', value: 'Jane' },
        {
          label: 'Powers',
          value: '',
          structured: [{ label: 'Sign', value: 'Invoices' }],
        },
      ],
    },
  ],
  expirationDate: '',
};

async function createFixture(preview: CredentialPreview): Promise<ComponentFixture<CredentialConfirmationModalComponent>> {
  // CredentialConfirmationModalComponent's own standalone `imports: [IonicModule, ...]` resolves
  // a fresh ModalController scoped to the component's injector, shadowing a TestBed-level
  // provider override (same pattern as activity-detail.component.spec.ts).
  TestBed.overrideComponent(CredentialConfirmationModalComponent, {
    add: { providers: [{ provide: ModalController, useValue: mockModalController }] },
  });

  await TestBed.configureTestingModule({
    imports: [CredentialConfirmationModalComponent, TranslateModule.forRoot()],
    providers: [{ provide: ModalController, useValue: mockModalController }],
  }).compileComponents();

  const fixture = TestBed.createComponent(CredentialConfirmationModalComponent);
  fixture.componentInstance.preview = preview;
  fixture.detectChanges();
  return fixture;
}

describe('CredentialConfirmationModalComponent', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create', async () => {
    const fixture = await createFixture(BASE_PREVIEW);
    expect(fixture.componentInstance).toBeTruthy();
  });

  // AC-10 / NFR-S-142-08: credential content must never be handed to a page
  // translation engine, regardless of whether the EUD-142 runtime translation
  // feature is enabled or even available on the device (AD-4).
  describe('translate="no" shielding (AC-10, NFR-S-142-08)', () => {
    it('marks the content root as non-translatable', async () => {
      const fixture = await createFixture(BASE_PREVIEW);
      const root = fixture.nativeElement.querySelector('.modal-content');
      expect(root.getAttribute('translate')).toBe('no');
    });

    it('marks the credential name as non-translatable', async () => {
      const fixture = await createFixture(BASE_PREVIEW);
      const el = fixture.nativeElement.querySelector('.credential-name');
      expect(el.getAttribute('translate')).toBe('no');
      expect(el.textContent).toContain('LEAR Credential Employee');
    });

    it('marks each section title as non-translatable', async () => {
      const fixture = await createFixture(BASE_PREVIEW);
      const el = fixture.nativeElement.querySelector('.section-title');
      expect(el.getAttribute('translate')).toBe('no');
    });

    it('marks simple field label and value as non-translatable', async () => {
      const fixture = await createFixture(BASE_PREVIEW);
      const label = fixture.nativeElement.querySelector('.field-row .field-label');
      const value = fixture.nativeElement.querySelector('.field-row .field-value');
      expect(label.getAttribute('translate')).toBe('no');
      expect(value.getAttribute('translate')).toBe('no');
    });

    it('marks structured field key and value as non-translatable', async () => {
      const fixture = await createFixture(BASE_PREVIEW);
      const key = fixture.nativeElement.querySelector('.structured-key');
      const val = fixture.nativeElement.querySelector('.structured-val');
      expect(key.getAttribute('translate')).toBe('no');
      expect(val.getAttribute('translate')).toBe('no');
    });
  });
});
