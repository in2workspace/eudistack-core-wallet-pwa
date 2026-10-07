import { ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule, ModalController } from '@ionic/angular';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { TxCodeModalComponent } from './tx-code-modal.component';

describe('TxCodeModalComponent', () => {
  let component: TxCodeModalComponent;
  let fixture: ComponentFixture<TxCodeModalComponent>;
  let modalCtrl: { dismiss: jest.Mock };

  beforeEach(async () => {
    modalCtrl = { dismiss: jest.fn() };

    TestBed.overrideComponent(TxCodeModalComponent, {
      add: { providers: [{ provide: ModalController, useValue: modalCtrl }] },
    });

    await TestBed.configureTestingModule({
      imports: [TxCodeModalComponent, IonicModule.forRoot(), TranslateModule.forRoot()],
      providers: [{ provide: ModalController, useValue: modalCtrl }],
    }).compileComponents();

    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      confirmation: { cancel: 'Cancel', validate: 'Validate', 'time-remaining': 'Time remaining' },
      'otp-input': { 'digit-aria': 'Digit {{index}} of {{length}}' },
    });
    translate.use('en');

    fixture = TestBed.createComponent(TxCodeModalComponent);
    component = fixture.componentInstance;
    component.txCodeLength = 6;
    fixture.detectChanges();
  });

  function validateButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.tx-code-btn-confirm');
  }

  function cancelButton(): HTMLButtonElement {
    return fixture.nativeElement.querySelector('.tx-code-btn-cancel');
  }

  describe('validate button', () => {
    it('Render_Initially_ShowsDisabledValidateButton', () => {
      // Arrange

      // Act
      const button = validateButton();

      // Assert
      expect(button.textContent?.trim()).toBe('Validate');
      expect(button.disabled).toBe(true);
    });

    it('Render_PartialCode_KeepsValidateButtonDisabled', () => {
      // Arrange
      component.onChanged('123');

      // Act
      fixture.detectChanges();

      // Assert
      expect(validateButton().disabled).toBe(true);
    });

    it('Render_CompleteCode_EnablesValidateButton', () => {
      // Arrange
      component.onChanged('123456');

      // Act
      fixture.detectChanges();

      // Assert
      expect(validateButton().disabled).toBe(false);
    });

    it('Click_CompleteCode_DismissesWithTxCodeAndConfirmRole', () => {
      // Arrange
      component.onChanged('123456');
      fixture.detectChanges();

      // Act
      validateButton().click();

      // Assert
      expect(modalCtrl.dismiss).toHaveBeenCalledTimes(1);
      expect(modalCtrl.dismiss).toHaveBeenCalledWith({ txCode: '123456' }, 'confirm');
    });

    it('Click_IncompleteCode_DoesNotDismiss', () => {
      // Arrange
      component.onChanged('12345');
      fixture.detectChanges();

      // Act
      validateButton().click();

      // Assert
      expect(modalCtrl.dismiss).not.toHaveBeenCalled();
    });

    it('Render_CustomTxCodeLength_EnablesButtonOnlyWhenLengthReached', () => {
      // Arrange
      component.txCodeLength = 4;
      component.onChanged('1234');

      // Act
      fixture.detectChanges();

      // Assert
      expect(validateButton().disabled).toBe(false);
    });
  });

  describe('keyboard submission', () => {
    it('OnCompleted_EnterOnFullCode_DismissesWithConfirmRole', () => {
      // Arrange
      const code = '654321';

      // Act
      component.onCompleted(code);

      // Assert
      expect(modalCtrl.dismiss).toHaveBeenCalledWith({ txCode: code }, 'confirm');
    });
  });

  describe('cancel button', () => {
    it('Click_Cancel_DismissesWithCancelRole', () => {
      // Arrange

      // Act
      cancelButton().click();

      // Assert
      expect(modalCtrl.dismiss).toHaveBeenCalledWith(null, 'cancel');
    });
  });

  describe('error state', () => {
    it('OnChanged_AfterError_ClearsErrorMessage', () => {
      // Arrange
      component.error = 'Invalid PIN';

      // Act
      component.onChanged('1');

      // Assert
      expect(component.error).toBe('');
    });
  });
});
