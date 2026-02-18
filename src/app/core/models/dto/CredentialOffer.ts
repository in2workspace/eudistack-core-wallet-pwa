import { AuthorizationCodeGrant } from "../AuthorizationCodeGrant";
import { PreAuthorizedCodeGrant } from "../PreAuthorizedCodeGrant";


export interface CredentialOffer {
  credentialIssuer: string;
  credentials?: CredentialOfferCredential[];
  credentialConfigurationsIds: string[];
  grant: CredentialOfferGrant;
}

export interface CredentialOfferCredential {
  format?: string;
  types?: string[];
  trustFramework?: CredentialOfferTrustFramework;
}

export interface CredentialOfferTrustFramework {
  name?: string;
  type?: string;
  uri?: string;
}

export interface CredentialOfferGrant {
  preAuthorizedCodeGrant?: PreAuthorizedCodeGrant;
  authorizationCodeGrant?: AuthorizationCodeGrant;
}
