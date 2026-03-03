import { AuthorisationServerMetadata } from '../../models/dto/AuthorisationServerMetadata';

export type IssuanceProfile = 'pre-auth' | 'plain' | 'haip';

export function detectIssuanceProfile(metadata: AuthorisationServerMetadata): IssuanceProfile {
  const dpopAlgs = metadata.dpopSigningAlgValuesSupported;
  const hasDpop = Array.isArray(dpopAlgs) && dpopAlgs.length > 0;
  const hasPar = !!metadata.pushedAuthorizationRequestEndpoint;
  const authMethods = metadata.tokenEndpointAuthMethodsSupported;
  const hasWia = Array.isArray(authMethods) && authMethods.includes('attest_jwt_client_auth');

  if (hasDpop && hasPar && hasWia) return 'haip';
  if (metadata.authorizationEndpoint) return 'plain';
  return 'pre-auth';
}
