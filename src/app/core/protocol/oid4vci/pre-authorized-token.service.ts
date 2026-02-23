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
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { retryUserMessage, wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';

//todo
const TIMEOUT_DURATION_S = 55;


@Injectable({ providedIn: 'root' })
export class PreAuthorizedTokenService {
  private readonly walletService = inject(WalletService);
  private readonly alertController = inject(AlertController);
  private readonly loader = inject(LoaderService);
  private readonly translate = inject(TranslateService);

  async getPreAuthorizedToken(
    credentialOffer: CredentialOffer,
    authorisationServerMetadata: AuthorisationServerMetadata
  ): Promise<TokenResponse> {
  const tokenURL = authorisationServerMetadata.tokenEndpoint;
  if (!tokenURL) {
      const msg = 'Token endpoint URL is missing in authorisation server metadata';
      throw new Oid4vciError(msg, { userMessage: retryUserMessage('Invalid authorization server metadata') });
  }

  let code: string | null = null;

  const preAuth = credentialOffer?.grant?.preAuthorizedCodeGrant;
  const needsCode = !!preAuth?.userPinRequired || preAuth?.txCode != null;

  if (needsCode) {
    code = await this.openPromptAndGetCode();
  }

  this.loader.addLoadingProcess();

    try {
      const raw = await this.getAccessToken(tokenURL, credentialOffer, code);
      return this.parseTokenResponse(raw);
    } finally {
      this.loader.removeLoadingProcess();
    }
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
      return await firstValueFrom(
        this.walletService.postFromUrlForTextResponse(tokenURL, body)
      );
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;
      if (e instanceof HttpErrorResponse) {
        const userMsg = (e.status >= 400 && e.status < 600) ? 'Incorrect PIN. Try again.' : retryUserMessage('Could not get access token');
        wrapOid4vciHttpError(e, 'Could not get access token', { userMessage: userMsg });
      }

      throw new Oid4vciError('Could not get access token', {
        cause: e,
        userMessage: retryUserMessage('Could not get access token'),
      });
    }
  }

  private parseTokenResponse(response: string): TokenResponse {
    try {
      return JSON.parse(response) as TokenResponse;
    } catch (e: unknown) {
      const msg = 'Invalid token response';
      throw new Oid4vciError(`${msg} (malformed JSON)`, {
        cause: e,
        userMessage: retryUserMessage(msg),
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
        if (interval != null) globalThis.clearInterval(interval);
      };

      const safeResolve = (pin: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(pin);
      };

      const safeReject = (err: unknown) => {
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
                safeReject(
                new Oid4vciError('User cancelled PIN entry', {
                  code: 'user_cancelled',
                })
              );
              return true;
            },
          },
          {
            text: send,
            handler: (alertData: { pin?: string }) => {
              const pin = String(alertData?.pin ?? '').trim();

              if (!pin) {
                safeReject(
                  new Oid4vciError('PIN is empty', {
                    userMessage: 'PIN is required.',
                  })
                );
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
            if (settled) return;
            safeReject(
              new Oid4vciError('PIN request timed out', {
                userMessage: retryUserMessage('PIN request timed out'),
              })
            );
          });

          interval = this.startCountdown(alert, description, counter);

          return alert.present();
        })
        .catch((err) => {
          safeReject(
            new Oid4vciError('Could not open PIN prompt', {
              cause: err,
              userMessage: retryUserMessage('Could not open PIN prompt'),
            })
          );
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
  
    const interval = globalThis.setInterval(() => {

      if (counter > 0) {
        counter--;
        const message = this.translate.instant('confirmation.messageHtml', {
        description,
        counter,
    });
        alert.message = message;
      } else {
        globalThis.clearInterval(interval);
        alert.dismiss();
      }
    }, 1000);
  
    return interval;
  }
}