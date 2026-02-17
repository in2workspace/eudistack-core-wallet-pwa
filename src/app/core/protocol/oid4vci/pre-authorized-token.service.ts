import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/CredentialOffer';
import { TokenResponse } from '../../models/TokenResponse';
import { CONTENT_TYPE, CONTENT_TYPE_URL_ENCODED_FORM } from 'src/app/constants/content-type.constants';
import { AuthorisationServerMetadata } from '../../models/AuthorisationServerMetadata';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/constants/credential-offer.constants';
import { AlertController, AlertOptions } from '@ionic/angular';
import { LoaderService } from 'src/app/services/loader.service';
import { TranslateService } from '@ngx-translate/core';
import { ToastServiceHandler } from 'src/app/services/toast.service';

//todo
const TIMEOUT_DURATION_S = 55;


@Injectable({ providedIn: 'root' })
export class PreAuthorizedTokenService {
  private readonly http = inject(HttpClient);
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
  const raw = await this.getAccessToken(tokenURL, credentialOffer, code);
  this.loader.removeLoadingProcess();
  return this.parseTokenResponse(raw);
}

  private async getAccessToken(
    tokenURL: string,
    credentialOffer: CredentialOffer,
    pin: string | null
  ): Promise<string> {
    const formData = new Map<string, string>();
    formData.set('grant_type', PRE_AUTH_CODE_GRANT_TYPE);
    formData.set(
      'pre-authorized_code',
      credentialOffer?.grant?.preAuthorizedCodeGrant?.preAuthorizedCode ?? ''
    );

    if (
      credentialOffer?.grant?.preAuthorizedCodeGrant?.userPinRequired &&
      pin != null &&
      pin.length > 0
    ) {
      formData.set('user_pin', pin);
    } else if (credentialOffer?.grant?.preAuthorizedCodeGrant?.txCode != null) {
      // In the Java version, tx_code is sent with the provided "pin" value in this branch.
      formData.set('tx_code', pin ?? '');
    }

    const body = this.toXWwwFormUrlEncoded(formData);

    try {
      return await firstValueFrom(
        this.http.post(tokenURL, body, {
          headers: new HttpHeaders({ [CONTENT_TYPE]: CONTENT_TYPE_URL_ENCODED_FORM }),
          responseType: 'text'
        })
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
    console.log("Opening prompt to get code.");  
  
    const description = this.translate.instant('confirmation.description');
    //todo review if it comes from Issuer
    // const counter = data.timeout || 60;
    const counter = TIMEOUT_DURATION_S;

    let interval: number;

    const cancel = this.translate.instant('confirmation.cancel');
    const send = this.translate.instant('confirmation.send');
    const header = this.translate.instant('confirmation.pin');

    const message = this.translate.instant('confirmation.messageHtml', { description, counter });
    
    return new Promise<string>(async (resolve, reject) => {

      const cleanup = () => {
        if (interval != null  || interval !== undefined) window.clearInterval(interval);
        if (this.loadingTimeout != null || this.loadingTimeout !== undefined) clearTimeout(this.loadingTimeout);
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
              cleanup();
              reject(new Error('User cancelled PIN entry'));
              return true;
            },
          },
          {
            text: send,
            handler: (alertData: { pin?: string }) => {
              cleanup();
              const pin = String(alertData?.pin ?? '').trim();

              if (!pin) {
                reject(new Error('PIN is empty'));
                return false;
              }

              resolve(pin);
              return true;
            },
          },
        ],
        backdropDismiss: false,
      };

      const alert = await this.alertController.create(alertOptions);


      alert.onDidDismiss().then(() => {
        if (interval != null) window.clearInterval(interval);
        if (this.loadingTimeout != null) clearTimeout(this.loadingTimeout);

        reject(new Error('PIN request timed out'));
      });

      interval = this.startCountdown(alert, description, counter);
      await alert.present();
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