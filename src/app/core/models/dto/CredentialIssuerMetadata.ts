export interface CredentialIssuerMetadata {
  credentialIssuer?: string;
  credentialEndpoint?: string;
  deferredCredentialEndpoint?: string;
  notification_endpoint?: string;
  issuance_endpoint?: string;
  credentialsSupported?: unknown;
  credential_configurations_supported: {[key: string]: CredentialsConfigurationsSuppported}; 

  /** Field that is hardcoded in the deprecated backend method. */
  authorizationServer?: string;

  /** Backward-compat check field. */
  credentialToken?: unknown;

  [key: string]: unknown;
}

export interface CredentialsConfigurationsSuppported{
  format: string;
  cryptographic_binding_methods_supported?: string[];
}

export interface CredentialsSupported{
  format: string;
  type: string;
  trustFramework: TrustFramework;
  display: Display[];
}

export interface TrustFramework{
  name: string;
  type: string;
  uri: string;
}

export interface Display{
  name: string;
  locale: string;
}