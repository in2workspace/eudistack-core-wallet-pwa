import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, from } from 'rxjs';
import { CONTENT_TYPE, CONTENT_TYPE_APPLICATION_JSON } from 'src/app/constants/content-type.constants';
import { CredentialOffer, CredentialOfferCredential, CredentialOfferGrant } from '../../models/dto/CredentialOffer';
import { PRE_AUTH_CODE_GRANT_TYPE } from 'src/app/constants/credential-offer.constants';

@Injectable({ providedIn: 'root' })
export class CredentialOfferService {
 
  private readonly http = inject(HttpClient);

  async getCredentialOfferFromCredentialOfferUri(
    credentialOfferUri: string
  ): Promise<CredentialOffer> {
    const parsedUri = this.parseCredentialOfferUri(credentialOfferUri);

    const responseText = await this.getCredentialOffer(parsedUri);

    const offer = this.parseAndNormalizeCredentialOffer(responseText);

    this.validateCredentialOffer(offer);

    return offer;
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
    const headers = new HttpHeaders({ [CONTENT_TYPE]: CONTENT_TYPE_APPLICATION_JSON });

    try {
      return firstValueFrom(this.http.get(credentialOfferUri, { headers, responseType: 'text' }));
    } catch (e) {
      console.error('Error fetching credential offer:', e);
      // todo handle error
      throw e as HttpErrorResponse;
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
    } catch {
      throw new Error('Error while deserializing Credential Offer: invalid JSON');
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
        ? Array.from(root.credential_configuration_ids).map((x: any) => String(x))
        : [],
      grant: this.mapGrant(root?.grants),
    };
  }

  private mapCredential(c: any): CredentialOfferCredential {
    return {
      format: c?.format,
      types: Array.isArray(c?.types) ? c.types.map((t: any) => String(t)) : undefined,
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

  if (value !== undefined) {
    console.warn(
      `Invalid user_pin_required value in credential offer. Expected boolean, got: ${typeof value}. Falling back to false.`
    );
  } else {
    console.warn(`Missing user_pin_required in credential offer. Falling back to false.`);
  }

  return false;
}

  private asNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private validateCredentialOffer(credentialOffer: CredentialOffer): void {
    //todo handle errors
    if (!credentialOffer) {
      throw new Error(`Credential Offer is null`);
    }
    if (!credentialOffer.credentialIssuer || credentialOffer.credentialIssuer.trim().length === 0) {
      throw new Error(`Missing required field: credentialIssuer`);
    }
    if (!credentialOffer.credentialConfigurationsIds || credentialOffer.credentialConfigurationsIds.length === 0) {
      throw new Error(`Missing required field: credentialConfigurationIds`);
    }
    if (!credentialOffer.grant) {
      throw new Error(`Missing required field: grants`);
    }
  }
}