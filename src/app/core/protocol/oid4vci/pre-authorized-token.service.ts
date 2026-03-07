import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/core/constants/credential-offer.constants';
import { ModalController } from '@ionic/angular';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { TranslateService } from '@ngx-translate/core';
import { WalletService } from 'src/app/core/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';
import { HttpErrorResponse } from '@angular/common/http';
import { TxCodeModalComponent } from 'src/app/shared/components/tx-code-modal/tx-code-modal.component';


const TIMEOUT_DURATION_S = 55;

@Injectable({ providedIn: 'root' })
export class PreAuthorizedTokenService {
  private readonly walletService = inject(WalletService);
  private readonly modalController = inject(ModalController);
  private readonly loader = inject(LoaderService);
  private readonly translate = inject(TranslateService);

  async getPreAuthorizedToken(
    credentialOffer: CredentialOffer,
    authorisationServerMetadata: AuthorisationServerMetadata
  ): Promise<TokenResponse> {
    const tokenURL = authorisationServerMetadata.tokenEndpoint;
    if (!tokenURL) {
      throw new Oid4vciError('Token endpoint URL is missing in authorisation server metadata', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const preAuth = credentialOffer?.grant?.preAuthorizedCodeGrant;
    const needsCode = !!preAuth?.userPinRequired || preAuth?.txCode != null;

    let code: string | null = null;
    if (needsCode) {
      code = await this.openTxCodeModal();
    }

    this.loader.addLoadingProcess();

    try {
      const raw = await this.fetchAccessToken(tokenURL, credentialOffer, code);
      return this.parseTokenResponse(raw);
    } finally {
      this.loader.removeLoadingProcess();
    }
  }

  private async fetchAccessToken(
    tokenURL: string,
    credentialOffer: CredentialOffer,
    code: string | null
  ): Promise<string> {
    const formData = new Map<string, string>();
    formData.set('grant_type', PRE_AUTH_CODE_GRANT_TYPE);
    formData.set('pre-authorized_code', credentialOffer?.grant?.preAuthorizedCodeGrant?.preAuthorizedCode ?? '');

    if (credentialOffer?.grant?.preAuthorizedCodeGrant?.userPinRequired && code != null && code.length > 0) {
      formData.set('user_pin', code);
    } else if (credentialOffer?.grant?.preAuthorizedCodeGrant?.txCode != null && code && code.length > 0) {
      formData.set('tx_code', code);
    }

    const body = this.toXWwwFormUrlEncoded(formData);

    try {
      return await firstValueFrom(this.walletService.postFromUrlForTextResponse(tokenURL, body));
    } catch (e: unknown) {
        if (e instanceof HttpErrorResponse) {
          wrapOid4vciHttpError(e, 'Could not get access token', {
            translationKey: 'errors.cannot-get-access-token',
          });
        }

        throw new Oid4vciError('Could not get access token (unexpected error type)', {
          cause: e,
          translationKey: 'errors.cannot-get-access-token',
        });
    }
  }

  private parseTokenResponse(response: string): TokenResponse {
    try {
      return JSON.parse(response) as TokenResponse;
    } catch (e: unknown) {
      throw new Oid4vciError('Invalid token response (malformed JSON)', {
        cause: e,
        translationKey: 'errors.invalid-token-response',
      });
    }
  }

  private toXWwwFormUrlEncoded(formData: Map<string, string>): string {
    const parts: string[] = [];
    for (const [k, v] of formData.entries()) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return parts.join('&');
  }

  private async openTxCodeModal(): Promise<string> {
    const header = this.translate.instant('confirmation.pin');
    const description = this.translate.instant('confirmation.description');

    const modal = await this.modalController.create({
      component: TxCodeModalComponent,
      cssClass: 'tx-code-modal-wrapper',
      componentProps: {
        header,
        description,
        txCodeLength: 6,
        timeoutSeconds: TIMEOUT_DURATION_S,
      },
      backdropDismiss: false,
    });

    await modal.present();

    const { data, role } = await modal.onDidDismiss();

    if (role === 'cancel') {
      throw new Oid4vciError('User cancelled tx_code entry', {
        code: 'user_cancelled',
      });
    }

    if (role === 'timeout') {
      throw new Oid4vciError('tx_code request timed out', {
        translationKey: 'errors.pin-timeout',
      });
    }

    return data?.txCode ?? '';
  }
}
