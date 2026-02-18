import { CredentialsConfigurationsSuppported } from "./dto/CredentialIssuerMetadata";

export interface CredentialConfigurationContext {
  credentialConfigurationId: string;
  configuration: CredentialsConfigurationsSuppported;
  format: string;
  isCryptographicBindingSupported: boolean;
}