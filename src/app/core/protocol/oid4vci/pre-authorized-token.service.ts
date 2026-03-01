import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer } from '../../models/dto/CredentialOffer';
import { TokenResponse } from '../../models/dto/TokenResponse';
import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/core/constants/credential-offer.constants';
import { AlertController, AlertOptions } from '@ionic/angular';
import { LoaderService } from 'src/app/shared/services/loader.service';
import { TranslateService } from '@ngx-translate/core';
import { WalletService } from 'src/app/core/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/shared/helpers/http-error-message';
import { HttpErrorResponse } from '@angular/common/http';


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
      throw new Oid4vciError('Token endpoint URL is missing in authorisation server metadata', {
        translationKey: 'errors.invalid-auth-server-metadata',
      });
    }

    const preAuth = credentialOffer?.grant?.preAuthorizedCodeGrant;
    const needsCode = !!preAuth?.userPinRequired || preAuth?.txCode != null;

    let code: string | null = null;
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

  private async openPromptAndGetCode(): Promise<string> {
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
                translationKey: 'errors.pin-timeout',
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
              translationKey: 'errors.cannot-open-pin-prompt',
            })
          );
        });
    });
  }

  private startCountdown(alert: any, description: string, initialCounter: number): number {
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