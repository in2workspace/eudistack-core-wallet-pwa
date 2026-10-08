import { TestBed } from '@angular/core/testing';
import { ModalController } from '@ionic/angular';
import { TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { PreAuthorizedTokenService } from './pre-authorized-token.service';
import { WalletService } from 'src/app/core/services/wallet.service';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';

const METADATA = { tokenEndpoint: 'https://as.example/token' } as AuthorisationServerMetadata;

const offerWith = (grant: Record<string, unknown>): CredentialOffer =>
  ({ grant: { preAuthorizedCodeGrant: grant } }) as unknown as CredentialOffer;

describe('PreAuthorizedTokenService', () => {
  let service: PreAuthorizedTokenService;
  let postFromUrlForTextResponse: jest.Mock;
  let addLoadingProcess: jest.Mock;
  let removeLoadingProcess: jest.Mock;
  let create: jest.Mock;
  let onDidDismiss: jest.Mock;
  let present: jest.Mock;

  beforeEach(() => {
    postFromUrlForTextResponse = jest
      .fn()
      .mockReturnValue(of(JSON.stringify({ access_token: 'at-123', c_nonce: 'n-1' })));
    addLoadingProcess = jest.fn();
    removeLoadingProcess = jest.fn();
    present = jest.fn().mockResolvedValue(undefined);
    onDidDismiss = jest.fn().mockResolvedValue({ data: { txCode: '123456' }, role: 'confirm' });
    create = jest.fn().mockResolvedValue({ present, onDidDismiss });

    TestBed.configureTestingModule({
      providers: [
        PreAuthorizedTokenService,
        { provide: WalletService, useValue: { postFromUrlForTextResponse } },
        { provide: LoaderService, useValue: { addLoadingProcess, removeLoadingProcess } },
        { provide: ModalController, useValue: { create } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });

    service = TestBed.inject(PreAuthorizedTokenService);
  });

  const bodyOf = (): URLSearchParams =>
    new URLSearchParams(postFromUrlForTextResponse.mock.calls[0][1]);

  it('rejects authorisation server metadata without a token endpoint', async () => {
    await expect(
      service.getPreAuthorizedToken(offerWith({ preAuthorizedCode: 'code-1' }), {} as AuthorisationServerMetadata)
    ).rejects.toMatchObject({ translationKey: 'errors.invalid-auth-server-metadata' });

    expect(addLoadingProcess).not.toHaveBeenCalled();
  });

  it('exchanges the pre-authorized code without prompting when no tx_code is required', async () => {
    const result = await service.getPreAuthorizedToken(
      offerWith({ preAuthorizedCode: 'code-1' }),
      METADATA
    );

    expect(create).not.toHaveBeenCalled();
    expect(postFromUrlForTextResponse).toHaveBeenCalledWith(
      'https://as.example/token',
      expect.any(String)
    );
    expect(bodyOf().get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:pre-authorized_code');
    expect(bodyOf().get('pre-authorized_code')).toBe('code-1');
    expect(bodyOf().get('user_pin')).toBeNull();
    expect(bodyOf().get('tx_code')).toBeNull();
    expect(result).toEqual({ access_token: 'at-123', c_nonce: 'n-1' });
    expect(addLoadingProcess).toHaveBeenCalledTimes(1);
    expect(removeLoadingProcess).toHaveBeenCalledTimes(1);
  });

  it('prompts for the code and sends it as user_pin for a legacy userPinRequired offer', async () => {
    await service.getPreAuthorizedToken(
      offerWith({ preAuthorizedCode: 'code-1', userPinRequired: true }),
      METADATA
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        cssClass: 'tx-code-modal-wrapper',
        backdropDismiss: false,
        componentProps: expect.objectContaining({ txCodeLength: 6, timeoutSeconds: 55 }),
      })
    );
    expect(present).toHaveBeenCalledTimes(1);
    expect(bodyOf().get('user_pin')).toBe('123456');
  });

  it('sends the code as tx_code when the offer declares a txCode descriptor', async () => {
    await service.getPreAuthorizedToken(
      offerWith({ preAuthorizedCode: 'code-1', txCode: { length: 6, inputMode: 'numeric' } }),
      METADATA
    );

    expect(bodyOf().get('tx_code')).toBe('123456');
    expect(bodyOf().get('user_pin')).toBeNull();
  });

  it('aborts as a user cancellation when the code modal is dismissed', async () => {
    onDidDismiss.mockResolvedValue({ data: null, role: 'cancel' });

    await expect(
      service.getPreAuthorizedToken(
        offerWith({ preAuthorizedCode: 'code-1', userPinRequired: true }),
        METADATA
      )
    ).rejects.toMatchObject({ code: 'user_cancelled' });

    expect(postFromUrlForTextResponse).not.toHaveBeenCalled();
  });

});
