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
  credentialConfigurationId: string;
  holderKeyId?: string;
  holderKid?: string;
  /** Public key of the holder key (wire name: the payload is posted as is). The Wallet Unit Service compares it with the `cnf` of the attestation. */
  holder_public_jwk?: JsonWebKey;
}