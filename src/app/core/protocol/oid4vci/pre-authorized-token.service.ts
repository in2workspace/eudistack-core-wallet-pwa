import { inject, Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/constants/credential-offer.constants';
import { AlertController, AlertOptions } from '@ionic/angular';
import { LoaderService } from 'src/app/services/loader.service';
import { TranslateService } from '@ngx-translate/core';
import { WalletService } from 'src/app/services/wallet.service';

//todo
const TIMEOUT_DURATION_S = 55;


@Injectable({ providedIn: 'root' })
export class PreAuthorizedTokenService {
  private readonly walletService = inject(WalletService);
  private readonly alertController = inject(AlertController);
  private readonly loader = inject(LoaderService);
  private readonly translate = inject(TranslateService);

  private loadingTimeout: any;

  async getPreAuthorizedToken(
    credentialOffer: CredentialOffer,
    authorisationServerMetadata: AuthorisationServerMetadata
  ): Promise<TokenResponse> {
  const tokenURL = authorisationServerMetadata.tokenEndpoint;
  if (!tokenURL) {
    throw new Error('Token endpoint URL is missing in authorisation server metadata');
  }

  let code: string | null = null;

  const preAuth = credentialOffer?.grant?.preAuthorizedCodeGrant;
  const needsCode = !!preAuth?.userPinRequired || preAuth?.txCode != null;

  if (needsCode) {
    code = await this.openPromptAndGetCode();
  }

  this.loader.addLoadingProcess();
  //todo add error handler to communicat pin error or pin expired
  const raw = await this.getAccessToken(tokenURL, credentialOffer, code);
  this.loader.removeLoadingProcess();
  
  return this.parseTokenResponse(raw);
}

  private async getAccessToken(
    tokenURL: string,
    credentialOffer: CredentialOffer,
    code: string | null
  ): Promise<string> {
    const formData = new Map<string, string>();
    formData.set('grant_type', PRE_AUTH_CODE_GRANT_TYPE);
    formData.set(
      'pre-authorized_code',
      credentialOffer?.grant?.preAuthorizedCodeGrant?.preAuthorizedCode ?? ''
    );

    if (
      credentialOffer?.grant?.preAuthorizedCodeGrant?.userPinRequired &&
      code != null &&
      code.length > 0
    ) {
      formData.set('user_pin', code);
    } else if (credentialOffer?.grant?.preAuthorizedCodeGrant?.txCode != null && code && code.length > 0) {
      formData.set('tx_code', code);
    }

    const body = this.toXWwwFormUrlEncoded(formData);

    try {
      //todo if error, show error popup to say PIN is incorrect
      return await firstValueFrom(
        this.walletService.postFromUrlForTextResponse(tokenURL, body)
      );
    } catch (e: unknown) {
      const err = e as HttpErrorResponse;
      const status = err.status ?? 0;

      if (status >= 400 && status < 600) {
        throw new Error(`Incorrect PIN, the next error occurs: ${this.httpErrorToString(err)}`);
      }
      throw e;
    }
  }

  private parseTokenResponse(response: string): TokenResponse {
    try {
      return JSON.parse(response) as TokenResponse;
    } catch (e: unknown) {
      throw new Error(`Error parsing token response: ${String(e)}`);
    }
  }

  private toXWwwFormUrlEncoded(formData: Map<string, string>): string {
    const parts: string[] = [];
    for (const [k, v] of formData.entries()) {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    }
    return parts.join('&');
  }

  private httpErrorToString(err: HttpErrorResponse): string {
    const base = `status=${err.status} statusText=${err.statusText}`;
    if (typeof err.error === 'string' && err.error.length > 0) {
      return `${base} body=${err.error}`;
    }
    return base;
  }

  // todo review error cases (timeout, user cancellation, incorrect PIN)
  private async openPromptAndGetCode(): Promise<string> {
    console.log('Opening prompt to get code.');

    const description = this.translate.instant('confirmation.description');
    const counter = TIMEOUT_DURATION_S;

    let interval: number | undefined;

    const cancel = this.translate.instant('confirmation.cancel');
    const send = this.translate.instant('confirmation.send');
    const header = this.translate.instant('confirmation.pin');

    const message = this.translate.instant('confirmation.messageHtml', { description, counter });

    return new Promise<string>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        if (interval != null) window.clearInterval(interval);
        if (this.loadingTimeout != null) clearTimeout(this.loadingTimeout);
      };

      const safeResolve = (pin: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(pin);
      };

      const safeReject = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const alertOptions: AlertOptions = {
        header,
        message,
        inputs: [
          {
            name: 'pin',
            type: 'text',
            placeholder: 'PIN',
            attributes: {
              inputmode: 'numeric',
              pattern: '[0-9]*',
            },
          },
        ],
        buttons: [
          {
            text: cancel,
            role: 'cancel',
            handler: () => {
              safeReject(new Error('User cancelled PIN entry'));
              return true;
            },
          },
          {
            text: send,
            handler: (alertData: { pin?: string }) => {
              const pin = String(alertData?.pin ?? '').trim();

              if (!pin) {
                safeReject(new Error('PIN is empty'));
                return false;
              }

              safeResolve(pin);
              return true;
            },
          },
        ],
        backdropDismiss: false,
      };

      this.alertController
        .create(alertOptions)
        .then((alert) => {
          alert.onDidDismiss().then(() => {
            // If user already resolved/rejected via buttons, do nothing.
            if (settled) return;
            //todo show error popup
            safeReject(new Error('PIN request timed out'));
          });

          interval = this.startCountdown(alert, description, counter);

          return alert.present();
        })
        .catch((err) => {
          safeReject(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }


  //todo move to shared file to avoid duplication with WebsocketService
    private startCountdown(
    alert: any,
    description: string,
    initialCounter: number
  ): number {
    let counter = initialCounter;
  
    const interval = window.setInterval(() => {

      if (counter > 0) {
        counter--;
        const message = this.translate.instant('confirmation.messageHtml', {
        description,
        counter,
    });
        alert.message = message;
      } else {
        window.clearInterval(interval);
        alert.dismiss();
      }
    }, 1000);
  
    return interval;
  }
}