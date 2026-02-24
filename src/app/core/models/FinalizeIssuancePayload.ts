import { AuthorisationServerMetadata } from './dto/AuthorisationServerMetadata';
import { CredentialIssuerMetadata } from './dto/CredentialIssuerMetadata';
import { CredentialResponseWithStatusCode } from './CredentialResponseWithStatus';
import { TokenResponse } from './dto/TokenResponse';

export interface FinalizeIssuancePayload{
  credentialResponseWithStatus: CredentialResponseWithStatusCode;
  tokenResponse: TokenResponse;
  issuerMetadata: CredentialIssuerMetadata;
  authorisationServerMetadata: AuthorisationServerMetadata;
  tokenObtainedAt: number; // Unix timestamp in seconds
  format: string;
}