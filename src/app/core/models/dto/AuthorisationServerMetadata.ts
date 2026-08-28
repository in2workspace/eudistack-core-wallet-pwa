export interface AuthorisationServerMetadata {
  issuer?: string;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  jwksUri?: string;

  // Authorization Code / HAIP fields
  pushedAuthorizationRequestEndpoint?: string;
  requirePushedAuthorizationRequests?: boolean;
  codeChallengeMethodsSupported?: string[];
  dpopSigningAlgValuesSupported?: string[];
  tokenEndpointAuthMethodsSupported?: string[];
  grantTypesSupported?: string[];
  responseTypesSupported?: string[];
  authorizationResponseIssParameterSupported?: boolean;

  [key: string]: unknown;
}