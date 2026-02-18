export interface AuthorisationServerMetadata {
  issuer?: string;
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  jwksUri?: string;

  [key: string]: unknown;
}