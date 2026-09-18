import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { CredentialDecisionService, DecisionResult } from './credential-decision.service';
import { CredentialPreview } from '../models/credential-preview';

describe('CredentialDecisionService', () => {
  let service: CredentialDecisionService;
  let modalControllerSpy: jest.Mocked<ModalController>;
  let translateSpy: jest.Mocked<TranslateService>;

  beforeEach(() => {
    modalControllerSpy = {
      create: jest.fn()
    } as any;

    translateSpy = {
      instant: jest.fn()
    } as any;

    TestBed.configureTestingModule({
      providers: [
        CredentialDecisionService,
        { provide: ModalController, useValue: modalControllerSpy },
        { provide: TranslateService, useValue: translateSpy }
      ]
    });

    service = TestBed.inject(CredentialDecisionService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('showDecisionDialog', () => {
    const mockPreview = { id: '1', type: 'Test' } as any;

    async function setupModal(role: string) {
      const modalSpy = {
        present: jest.fn().mockResolvedValue(undefined),
        onDidDismiss: jest.fn().mockResolvedValue({ role })
      };
      modalControllerSpy.create.mockResolvedValue(modalSpy as any);
      return modalSpy;
    }

    it('should return ACCEPTED when role is confirm', async () => {
      await setupModal('confirm');
      const result = await service.showDecisionDialog(mockPreview);
      expect(result).toBe('ACCEPTED');
    });

    it('should return REJECTED when role is cancel', async () => {
      await setupModal('cancel');
      const result = await service.showDecisionDialog(mockPreview);
      expect(result).toBe('REJECTED');
    });

    it('should return TIMEOUT for other roles', async () => {
      await setupModal('timeout');
      const result = await service.showDecisionDialog(mockPreview);
      expect(result).toBe('TIMEOUT');
    });
  });

  describe('showTempMessage', () => {
    beforeEach(() => {
      translateSpy.instant.mockImplementation(key => key);
      document.body.innerHTML = '';
    });

    it('should create a toast element and remove it after timeout', fakeAsync(() => {
      service.showTempMessage('test.message', 'success');

      const toast = document.querySelector('.credential-toast');
      expect(toast).toBeTruthy();
      expect(toast?.innerHTML).toContain('checkmark-circle');
      expect(toast?.innerHTML).toContain('test.message');

      // Forward to animation frame
      tick(16);
      expect(toast?.classList.contains('visible')).toBe(true);

      // Forward to removal timeout
      tick(2500);
      expect(toast?.classList.contains('visible')).toBe(false);
      expect(toast?.classList.contains('exiting')).toBe(true);

      // Forward to fallback removal
      tick(500);
      expect(document.querySelector('.credential-toast')).toBeNull();
    }));

    it('should use error variant and handle html escaping', fakeAsync(() => {
      translateSpy.instant.mockReturnValue('<b>Dangerous</b> & "quoted"');
      service.showTempMessage('error.key', 'error');

      const toast = document.querySelector('.credential-toast') as HTMLElement;
      expect(toast?.getAttribute('data-variant')).toBe('error');
      expect(toast?.innerHTML).toContain('close-circle');
      // Escaped version check (JSDOM might not escape quotes in innerHTML exactly as &quot;)
      expect(toast?.innerHTML).toContain('&lt;b&gt;Dangerous&lt;/b&gt; &amp;');
      expect(toast?.innerHTML).toContain('quoted');

      tick(3000 + 500);
    }));

    it('showTempMessage defaults to success variant', fakeAsync(() => {
        service.showTempMessage('test.key');
        const toast = document.querySelector('.credential-toast');
        expect(toast?.getAttribute('data-variant')).toBe('success');
        tick(3500);
    }));

    it('escapeHtml handles null/undefined', () => {
        expect((service as any).escapeHtml(null)).toBe('');
        expect((service as any).escapeHtml(undefined)).toBe('');
    });
  });
});
