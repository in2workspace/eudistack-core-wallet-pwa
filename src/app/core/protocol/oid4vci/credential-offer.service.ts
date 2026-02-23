import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CredentialOffer, CredentialOfferCredential, CredentialOfferGrant } from '../../models/dto/CredentialOffer';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/constants/credential-offer.constants';
import { WalletService } from 'src/app/services/wallet.service';
import { Oid4vciError } from '../../models/error/Oid4vciError';
import { wrapOid4vciHttpError } from 'src/app/helpers/http-error-message';

@Injectable({ providedIn: 'root' })
export class CredentialOfferService {
 
  private readonly walletService = inject(WalletService);

    async getCredentialOfferFromCredentialOfferUri(credentialOfferUri: string): Promise<CredentialOffer> {
    try {
      const parsedUri = this.parseCredentialOfferUri(credentialOfferUri);

      const responseText = await this.getCredentialOffer(parsedUri);

      const offer = this.parseAndNormalizeCredentialOffer(responseText);

      this.validateCredentialOffer(offer);

      return offer;
    } catch (e: unknown) {
      if (e instanceof Oid4vciError) throw e;

      throw new Oid4vciError('Could not process the credential offer', {
        cause: e,
        translationKey: 'errors.default',
      });
    }
  }

  private parseCredentialOfferUri(credentialOfferUri: string): string {
    try {
      const parts = credentialOfferUri.split('=');
      const value = parts[1];
      if (!value) return credentialOfferUri;
      return decodeURIComponent(value);
    } catch {
      console.warn('Error parsing credential offer URI, using original value as fallback.');
      return credentialOfferUri;
    }
  }

  private async getCredentialOffer(credentialOfferUri: string): Promise<string> {
    try {
      return await firstValueFrom(this.walletService.getTextFromUrl(credentialOfferUri));
    } catch (e: unknown) {
      console.error('Error fetching credential offer:', e);
      wrapOid4vciHttpError(e, 'Could not download the credential offer', {
        translationKey: 'errors.cannot-download-credentialOffer',
      });
    }
  }

  private parseAndNormalizeCredentialOffer(responseText: string): CredentialOffer {
    const root = this.parseJsonOrThrow(responseText);
    const normalizedRoot = this.normalizeCredentialsShape(root);
    return this.mapCredentialOffer(normalizedRoot);
  }

  private parseJsonOrThrow(responseText: string): any {
    try {
      return JSON.parse(responseText);
    } catch(e: unknown) {
      throw new Oid4vciError('Invalid credential offer (malformed JSON)', {
        cause: e,
        translationKey: 'errors.invalid-credentialOffer',
      });
    }
  }

  private normalizeCredentialsShape(root: any): any {
    if (!root || !Array.isArray(root.credentials)) {
      return root;
    }

    const normalizedCredentials = root.credentials.map((cred: any) => {
      if (cred && typeof cred === 'object' && 'type' in cred && !('types' in cred)) {
        const typeValue = String(cred.type);
        const { type, ...rest } = cred;
        return { ...rest, types: [typeValue] };
      }
      return cred;
    });

    return { ...root, credentials: normalizedCredentials };
  }

  private mapCredentialOffer(root: any): CredentialOffer {
    return {
      credentialIssuer: root?.credential_issuer,
      credentials: Array.isArray(root?.credentials)
        ? root.credentials.map((c: any): CredentialOfferCredential => this.mapCredential(c))
        : undefined,
      credentialConfigurationsIds: root?.credential_configuration_ids
        ? Array.from(root.credential_configuration_ids).map(String)
        : [],
      grant: this.mapGrant(root?.grants),
    };
  }

  private mapCredential(c: any): CredentialOfferCredential {
    return {
      format: c?.format,
      types: Array.isArray(c?.types) ? c.types.map(String) : undefined,
      trustFramework: c?.trust_framework
        ? {
            name: c.trust_framework?.name,
            type: c.trust_framework?.type,
            uri: c.trust_framework?.uri,
          }
        : undefined,
    };
  }

  private mapGrant(grants: any): CredentialOfferGrant {
    const pre = grants?.[PRE_AUTH_CODE_GRANT_TYPE];
    const auth = grants?.authorization_code;

    return {
      preAuthorizedCodeGrant: this.mapPreAuthorizedGrant(pre),
      authorizationCodeGrant: this.mapAuthorizationCodeGrant(auth),
    };
  }

  private mapPreAuthorizedGrant(pre: any): CredentialOfferGrant['preAuthorizedCodeGrant'] {
  if (!pre) return undefined;

  return {
    preAuthorizedCode: pre?.['pre-authorized_code'],
    userPinRequired: this.getUserPinRequired(pre?.user_pin_required),
    txCode: this.mapTxCode(pre?.tx_code),
  };
}

  private mapAuthorizationCodeGrant(auth: any): CredentialOfferGrant['authorizationCodeGrant'] {
    if (!auth) return undefined;
    return { issuerState: auth?.issuer_state };
  }

  private mapTxCode(tx: any): NonNullable<CredentialOfferGrant['preAuthorizedCodeGrant']>['txCode'] {
    if (!tx) return undefined;

    return {
      inputMode: tx?.input_mode,
      length: this.asNumber(tx?.length),
      description: tx?.description,
    };
  }

  private getUserPinRequired(value: unknown): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (value === undefined) {
      console.warn("Missing user_pin_required in credential offer. Falling back to false.");
      return false;
    }

    console.warn(
      `Invalid user_pin_required value in credential offer. Expected boolean, got: ${typeof value}. Falling back to false.`
    );
    return false;
  }

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private validateCredentialOffer(credentialOffer: CredentialOffer): void {
    if (!credentialOffer) {
      throw new Oid4vciError('Credential offer is null', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }

    if (!credentialOffer.credentialIssuer || credentialOffer.credentialIssuer.trim().length === 0) {
      throw new Oid4vciError('Missing required field: credentialIssuer', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }

    if (!credentialOffer.credentialConfigurationsIds || credentialOffer.credentialConfigurationsIds.length === 0) {
      throw new Oid4vciError('Missing required field: credentialConfigurationIds', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }

    if (!credentialOffer.grant) {
      throw new Oid4vciError('Missing required field: grants', {
        translationKey: 'errors.invalid-credentialOffer',
      });
    }
  }
}