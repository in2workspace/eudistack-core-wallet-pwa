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
      // If it fails, assume it is already parsed.
      return credentialOfferUri;
    }
  }

  private async getCredentialOffer(credentialOfferUri: string): Promise<string> {
    const headers = new HttpHeaders({ [CONTENT_TYPE]: CONTENT_TYPE_APPLICATION_JSON });

    try {
      return firstValueFrom(this.http.get(credentialOfferUri, { headers, responseType: 'text' }));
    } catch (e) {
      // Let callers handle the standard Angular error type.
      throw e as HttpErrorResponse;
    }
  }

  private parseAndNormalizeCredentialOffer(responseText: string): CredentialOffer {
    let root: any;

    try {
      root = JSON.parse(responseText);
    } catch {
      throw new Error('Error while deserializing Credential Offer: invalid JSON');
    }

    // Normalize credentials array: if an element has "type" and not "types", convert.
    if (root && Array.isArray(root.credentials)) {
      root.credentials = root.credentials.map((cred: any) => {
        if (cred && typeof cred === 'object' && 'type' in cred && !('types' in cred)) {
          const typeValue = String(cred.type);
          const { type, ...rest } = cred;
          return { ...rest, types: [typeValue] };
        }
        return cred;
      });
    }

    const mapped: CredentialOffer = {
      credentialIssuer: root?.credential_issuer,
      credentials: Array.isArray(root?.credentials)
        ? root.credentials.map((c: any): CredentialOfferCredential => ({
            format: c?.format,
            types: Array.isArray(c?.types) ? c.types.map((t: any) => String(t)) : undefined,
            trustFramework: c?.trust_framework
              ? {
                  name: c.trust_framework?.name,
                  type: c.trust_framework?.type,
                  uri: c.trust_framework?.uri,
                }
              : undefined,
          }))
        : undefined,
      credentialConfigurationsIds: root?.credential_configuration_ids
        ? Array.from(root.credential_configuration_ids).map((x: any) => String(x))
        : [],
      grant: this.mapGrant(root?.grants),
    };

    return mapped;
  }

  private mapGrant(grants: any): CredentialOfferGrant {
    const pre = grants?.[PRE_AUTH_CODE_GRANT_TYPE];
    const auth = grants?.authorization_code;

    return {
      preAuthorizedCodeGrant: pre
        ? {
            preAuthorizedCode: pre?.['pre-authorized_code'],
            userPinRequired: typeof pre?.user_pin_required === 'boolean' ? pre.user_pin_required : undefined,
            txCode: pre?.tx_code
              ? {
                  inputMode: pre.tx_code?.input_mode,
                  length: typeof pre.tx_code?.length === 'number' ? pre.tx_code.length : undefined,
                  description: pre.tx_code?.description,
                }
              : undefined,
          }
        : undefined,
      authorizationCodeGrant: auth
        ? {
            issuerState: auth?.issuer_state,
          }
        : undefined,
    };
  }

  private validateCredentialOffer(credentialOffer: CredentialOffer): void {
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